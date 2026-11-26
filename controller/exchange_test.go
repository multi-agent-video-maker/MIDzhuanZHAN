package controller

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestExchangeOrdersUseTheSignedInUsersReceipt(t *testing.T) {
	const id = "40ee2553-4b5e-443b-9654-6f0d51542fd0"
	var receipt string
	upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Empty(t, r.Header.Get("Cookie"))
		w.Header().Set("Content-Type", "application/json")
		switch r.Method {
		case http.MethodPost:
			require.Empty(t, r.Header.Get("Authorization"))
			var payload map[string]string
			require.NoError(t, common.DecodeJson(r.Body, &payload))
			require.Equal(t, id, payload["id"])
			receipt = payload["receipt_token"]
			require.Len(t, receipt, 64)
		case http.MethodGet:
			if r.Header.Get("Authorization") != "Bearer "+receipt {
				w.WriteHeader(http.StatusNotFound)
				fmt.Fprint(w, `{"error":{"code":"NOT_FOUND","message":"private details"}}`)
				return
			}
		}
		fmt.Fprintf(w, `{"data":{"id":%q,"name":"Plus","type":"membership","status":"pending","sensitive_field":"private details"}}`, id)
	}))
	t.Cleanup(upstream.Close)
	service.InitHttpClient()
	client := service.GetSSRFProtectedHTTPClient()
	previous := client.Transport
	client.Transport = upstream.Client().Transport
	t.Cleanup(func() { client.Transport = previous })
	t.Setenv(exchangeShopURL, upstream.URL)

	router := gin.New()
	router.POST("/orders", func(c *gin.Context) {
		c.Set("id", 11)
		CreateExchangeOrder(c)
	})
	router.GET("/orders/:id", func(c *gin.Context) {
		if c.GetHeader("Test-User") == "owner" {
			c.Set("id", 11)
		} else {
			c.Set("id", 12)
		}
		GetExchangeOrder(c)
	})
	created := httptest.NewRecorder()
	payload := fmt.Sprintf(`{"id":%q,"type":"membership","name":"Plus","receipt_token":"ignored"}`, id)
	request := httptest.NewRequest(http.MethodPost, "/orders", strings.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer dashboard-only")
	router.ServeHTTP(created, request)
	require.Equal(t, http.StatusOK, created.Code)
	assert.NotContains(t, created.Body.String(), "private details")
	assert.NotContains(t, created.Body.String(), receipt)
	for _, tc := range []struct {
		user   string
		status int
	}{
		{"owner", http.StatusOK},
		{"another member", http.StatusNotFound},
	} {
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/orders/"+id, nil)
		req.Header.Set("Test-User", tc.user)
		router.ServeHTTP(recorder, req)
		assert.Equal(t, tc.status, recorder.Code)
		assert.NotContains(t, recorder.Body.String(), "private details")
	}
}

func TestExchangeFinanceUsesSettledCostAndKeepsUnknownAmountsOpen(t *testing.T) {
	ledger := reconcileExchangeFinance(exchangeFinanceSnapshot{Orders: []exchangeFinanceOrder{
		{ID: "first", Channel: "sms", CostCents: new(int64(25))},
		{ID: "second", Channel: "sms", CostCents: new(int64(19))},
		{ID: "third", Channel: "membership"},
	}}, []model.ExchangeOrderAmounts{
		{OrderID: "first", RevenueCents: new(int64(100)), CostCents: new(int64(200))},
		{OrderID: "third", RevenueCents: new(int64(500)), CostCents: new(int64(0))},
	})
	sms := ledger.Totals["sms"]
	assert.EqualValues(t, 44, sms.CostCents)
	assert.EqualValues(t, 100, sms.RevenueCents)
	require.NotNil(t, sms.ProfitCents)
	assert.EqualValues(t, 75, *sms.ProfitCents)
	assert.Equal(t, 1, sms.Missing)
	assert.Nil(t, ledger.Lines[1].ProfitCents)
	member := ledger.Totals["membership"]
	assert.Equal(t, 1, member.CostCount)
	require.NotNil(t, member.ProfitCents)
	assert.EqualValues(t, 500, *member.ProfitCents)
}

func TestExchangeWalletsUseProviderAvailableUSD(t *testing.T) {
	t.Setenv(exchangeSMSAPIKey, "test-only-sms-credential")
	t.Setenv(exchangeMembershipAPIKey, "test-only-membership-credential")
	service.InitHttpClient()
	client := service.GetSSRFProtectedHTTPClient()
	previous := client.Transport
	t.Cleanup(func() { client.Transport = previous })
	client.Transport = modelCatalogTransport(func(request *http.Request) (*http.Response, error) {
		var body string
		switch request.URL.String() {
		case "https://api.dogesms.com/v1/balance":
			assert.Equal(t, "Bearer test-only-sms-credential", request.Header.Get("Authorization"))
			body = `{"data":{"currency":"USD","balance_cents":0}}`
		case "https://birdpay.org/api/v1/account":
			assert.Equal(t, "Bearer test-only-membership-credential", request.Header.Get("Authorization"))
			body = `{"code":0,"data":{"wallet_available":"7.8","wallet_balance":"99.20"}}`
		default:
			t.Errorf("Unexpected wallet request: %s", request.URL.Host)
			return nil, fmt.Errorf("unexpected wallet request")
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body))}, nil
	})
	assert.Equal(t, &exchangeFinanceBalance{Currency: "USD", Cents: 0}, getExchangeSMSBalance(t.Context()))
	assert.Equal(t, &exchangeFinanceBalance{Currency: "USD", Cents: 780}, getExchangeMembershipBalance(t.Context()))
}

func TestExchangeFinanceAmountsAreUpsertedAcrossDatabases(t *testing.T) {
	const id = "d77b6fcd-e872-45a4-91eb-b1e2cb498554"
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(":memory:")
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN is not configured")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN is not configured")
				}
				driver = postgres.Open(dsn)
			}
			db, err := gorm.Open(driver)
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			t.Cleanup(func() { assert.NoError(t, sqlDB.Close()) })
			var version string
			versionQuery := "SELECT version()"
			if dialect == "sqlite" {
				versionQuery = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
			t.Log(version)
			require.NoError(t, db.AutoMigrate(&model.ExchangeOrderAmounts{}))
			tx := db.Begin()
			require.NoError(t, tx.Error)
			previous := model.DB
			model.DB = tx
			defer func() { model.DB = previous; tx.Rollback() }()
			require.NoError(t, model.SaveExchangeOrderAmounts(t.Context(), model.ExchangeOrderAmounts{
				OrderID: id, RevenueCents: new(int64(700)), UpdatedBy: 1,
			}))
			require.NoError(t, model.SaveExchangeOrderAmounts(t.Context(), model.ExchangeOrderAmounts{
				OrderID: id, CostCents: new(int64(250)), UpdatedBy: 2,
			}))
			entries, err := model.ListExchangeOrderAmounts(t.Context(), []string{id})
			require.NoError(t, err)
			require.Len(t, entries, 1)
			assert.Nil(t, entries[0].RevenueCents)
			require.NotNil(t, entries[0].CostCents)
			assert.EqualValues(t, 250, *entries[0].CostCents)
			assert.Equal(t, 2, entries[0].UpdatedBy)
		})
	}
}
