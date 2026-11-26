package controller

import (
	"context"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

const (
	exchangeFinanceURL       = "ALLFUN_EXCHANGE_FINANCE_URL"
	exchangeFinanceKey       = "ALLFUN_EXCHANGE_FINANCE_KEY"
	exchangeSMSAPIKey        = "ALLFUN_EXCHANGE_SMS_API_KEY"
	exchangeMembershipAPIKey = "ALLFUN_EXCHANGE_MEMBERSHIP_API_KEY"
	exchangeFinanceLimit     = 200
	exchangeMoneyLimit       = 100_000_000
)

var exchangeUSD = regexp.MustCompile("^(0|[1-9][0-9]{0,11})(\\.[0-9]{1,2})?$")

type exchangeFinanceBalance struct {
	Currency string `json:"currency"`
	Cents    int64  `json:"cents"`
}

type exchangeFinanceOrder struct {
	ID          string `json:"id"`
	Channel     string `json:"channel"`
	Name        string `json:"name"`
	Status      string `json:"status"`
	ConfirmedAt string `json:"confirmed_at"`
	CostCents   *int64 `json:"cost_cents"`
}

type exchangeFinanceSnapshot struct {
	Orders  []exchangeFinanceOrder `json:"orders"`
	Limited bool                   `json:"limited"`
}

type exchangeFinanceLine struct {
	exchangeFinanceOrder
	ActualCostCents *int64 `json:"actual_cost_cents"`
	RevenueCents    *int64 `json:"revenue_cents"`
	ManualCostCents *int64 `json:"manual_cost_cents"`
	ProfitCents     *int64 `json:"profit_cents"`
}

type exchangeFinanceTotals struct {
	RevenueCents int64  `json:"revenue_cents"`
	CostCents    int64  `json:"cost_cents"`
	RevenueCount int    `json:"revenue_count"`
	CostCount    int    `json:"cost_count"`
	ProfitCents  *int64 `json:"profit_cents"`
	Missing      int    `json:"missing"`
	Orders       int    `json:"orders"`
}

type exchangeFinanceLedger struct {
	Configured        bool                              `json:"configured"`
	SMSBalance        *exchangeFinanceBalance           `json:"sms_balance"`
	MembershipBalance *exchangeFinanceBalance           `json:"membership_balance"`
	Limited           bool                              `json:"limited"`
	Lines             []exchangeFinanceLine             `json:"lines"`
	Totals            map[string]*exchangeFinanceTotals `json:"totals"`
}

func GetExchangeFinance(c *gin.Context) {
	origin, key := exchangeOrigin(exchangeFinanceURL), strings.TrimSpace(os.Getenv(exchangeFinanceKey))
	if origin == nil || !exchangeNonce.MatchString(key) {
		common.ApiSuccess(c, exchangeFinanceLedger{})
		return
	}
	query := url.Values{}
	if month := c.Query("month"); month != "" {
		start, err := time.ParseInLocation("2006-01", month, time.FixedZone("UTC+8", 8*60*60))
		if err != nil {
			common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid request"))
			return
		}
		query.Set("from", start.UTC().Format("2006-01-02T15:04:05.000Z"))
		query.Set("until", start.AddDate(0, 1, 0).UTC().Format("2006-01-02T15:04:05.000Z"))
	}
	path := "/finance"
	if len(query) > 0 {
		path += "?" + query.Encode()
	}
	ctx, cancel := context.WithCancel(c.Request.Context())
	var smsBalance, membershipBalance *exchangeFinanceBalance
	var balances sync.WaitGroup
	defer func() {
		cancel()
		balances.Wait()
	}()
	balances.Go(func() { smsBalance = getExchangeSMSBalance(ctx) })
	balances.Go(func() { membershipBalance = getExchangeMembershipBalance(ctx) })
	snapshot, status, _ := exchangeRequest[exchangeFinanceSnapshot](ctx, origin, http.MethodGet, path, key, nil)
	if status != http.StatusOK || len(snapshot.Orders) > exchangeFinanceLimit {
		common.ApiErrorStatus(c, http.StatusBadGateway, common.NewMessage("Refresh failed"))
		return
	}
	ids := make([]string, 0, len(snapshot.Orders))
	for _, order := range snapshot.Orders {
		_, dateErr := time.Parse(time.RFC3339Nano, order.ConfirmedAt)
		if !exchangeOrderID.MatchString(order.ID) || (order.Channel != "sms" && order.Channel != "membership") ||
			!validExchangeAmount(order.CostCents) || dateErr != nil {
			common.ApiErrorStatus(c, http.StatusBadGateway, common.NewMessage("Refresh failed"))
			return
		}
		ids = append(ids, order.ID)
	}
	amounts, err := model.ListExchangeOrderAmounts(c.Request.Context(), ids)
	if err != nil {
		common.ApiErrorStatus(c, http.StatusServiceUnavailable, common.NewMessage("Refresh failed"))
		return
	}
	ledger := reconcileExchangeFinance(snapshot, amounts)
	balances.Wait()
	ledger.SMSBalance = smsBalance
	ledger.MembershipBalance = membershipBalance
	common.ApiSuccess(c, ledger)
}

func getExchangeSMSBalance(ctx context.Context) *exchangeFinanceBalance {
	key := strings.TrimSpace(os.Getenv(exchangeSMSAPIKey))
	if key == "" {
		return nil
	}
	origin := &url.URL{Scheme: "https", Host: "api.dogesms.com"}
	wallet, status, _ := exchangeRequest[struct {
		Currency string `json:"currency"`
		Cents    *int64 `json:"balance_cents"`
	}](ctx, origin, http.MethodGet, "/v1/balance", key, nil)
	if status != http.StatusOK || wallet.Currency != "USD" || wallet.Cents == nil ||
		*wallet.Cents < 0 || *wallet.Cents > 9_007_199_254_740_991 {
		return nil
	}
	return &exchangeFinanceBalance{Currency: "USD", Cents: *wallet.Cents}
}

func getExchangeMembershipBalance(ctx context.Context) *exchangeFinanceBalance {
	key := strings.TrimSpace(os.Getenv(exchangeMembershipAPIKey))
	if key == "" {
		return nil
	}
	origin := &url.URL{Scheme: "https", Host: "birdpay.org"}
	wallet, status, _ := exchangeRequest[struct {
		Available string `json:"wallet_available"`
	}](ctx, origin, http.MethodGet, "/api/v1/account", key, nil)
	if status != http.StatusOK || !exchangeUSD.MatchString(wallet.Available) {
		return nil
	}
	whole, fraction, _ := strings.Cut(wallet.Available, ".")
	cents, err := strconv.ParseInt(whole+(fraction + "00")[:2], 10, 64)
	if err != nil {
		return nil
	}
	return &exchangeFinanceBalance{Currency: "USD", Cents: cents}
}

func reconcileExchangeFinance(snapshot exchangeFinanceSnapshot, saved []model.ExchangeOrderAmounts) exchangeFinanceLedger {
	ledger := exchangeFinanceLedger{
		Configured: true,
		Limited:    snapshot.Limited,
		Lines:      make([]exchangeFinanceLine, 0, len(snapshot.Orders)),
		Totals:     map[string]*exchangeFinanceTotals{"sms": {}, "membership": {}},
	}
	amounts := make(map[string]model.ExchangeOrderAmounts, len(saved))
	for _, entry := range saved {
		amounts[entry.OrderID] = entry
	}
	for _, order := range snapshot.Orders {
		entry := amounts[order.ID]
		line := exchangeFinanceLine{exchangeFinanceOrder: order, RevenueCents: entry.RevenueCents, ManualCostCents: entry.CostCents}
		line.ActualCostCents = order.CostCents
		if line.ActualCostCents == nil {
			line.ActualCostCents = entry.CostCents
		}
		total := ledger.Totals[order.Channel]
		total.Orders++
		if line.RevenueCents != nil {
			total.RevenueCents += *line.RevenueCents
			total.RevenueCount++
		}
		if line.ActualCostCents != nil {
			total.CostCents += *line.ActualCostCents
			total.CostCount++
		}
		if line.RevenueCents != nil && line.ActualCostCents != nil {
			profit := *line.RevenueCents - *line.ActualCostCents
			line.ProfitCents = &profit
			if total.ProfitCents == nil {
				total.ProfitCents = new(int64)
			}
			*total.ProfitCents += profit
		} else {
			total.Missing++
		}
		ledger.Lines = append(ledger.Lines, line)
	}
	return ledger
}

func validExchangeAmount(cents *int64) bool {
	return cents == nil || (*cents >= 0 && *cents <= exchangeMoneyLimit)
}

func PutExchangeFinanceAmounts(c *gin.Context) {
	var payload map[string]*int64
	if !getExchangePayload(c, &payload) {
		return
	}
	orderID := c.Param("id")
	revenue, hasRevenue := payload["revenue_cents"]
	cost, hasCost := payload["cost_cents"]
	if !exchangeOrderID.MatchString(orderID) || len(payload) != 2 || !hasRevenue || !hasCost ||
		!validExchangeAmount(revenue) || !validExchangeAmount(cost) {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid request"))
		return
	}
	origin, key := exchangeOrigin(exchangeFinanceURL), strings.TrimSpace(os.Getenv(exchangeFinanceKey))
	if origin == nil || !exchangeNonce.MatchString(key) {
		common.ApiErrorStatus(c, http.StatusServiceUnavailable, common.NewMessage("The exchange service is unavailable."))
		return
	}
	snapshot, status, _ := exchangeRequest[exchangeFinanceSnapshot](c.Request.Context(), origin, http.MethodGet,
		"/finance?order="+orderID, key, nil)
	if status != http.StatusOK {
		common.ApiErrorStatus(c, http.StatusBadGateway, common.NewMessage("Refresh failed"))
		return
	}
	if len(snapshot.Orders) != 1 || snapshot.Orders[0].ID != orderID {
		common.ApiErrorStatus(c, http.StatusNotFound, common.NewMessage("Exchange order or key not found."))
		return
	}
	entry := model.ExchangeOrderAmounts{
		OrderID: orderID, RevenueCents: revenue, CostCents: cost,
		UpdatedBy: c.GetInt("id"), UpdatedAt: common.GetTimestamp(),
	}
	if err := model.SaveExchangeOrderAmounts(c.Request.Context(), entry); err != nil {
		common.ApiErrorStatus(c, http.StatusServiceUnavailable, common.NewMessage("Update failed"))
		return
	}
	common.ApiSuccess(c, nil)
}
