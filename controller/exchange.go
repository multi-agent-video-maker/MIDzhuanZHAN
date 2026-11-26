package controller

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

const (
	exchangeShopURL       = "ALLFUN_EXCHANGE_SHOP_URL"
	exchangeSMSProduct    = "接码服务 Key"
	exchangeResponseLimit = 1 << 20
)

var (
	exchangeOrderID    = regexp.MustCompile("^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$")
	exchangeNonce      = regexp.MustCompile("^[a-f0-9]{64}$")
	exchangeMemberKey  = regexp.MustCompile("^mem_[a-f0-9]{48}$")
	exchangeSMSKey     = regexp.MustCompile("^relay_[a-f0-9]{48}$")
	exchangeSMSSession = regexp.MustCompile("^session_[a-f0-9]{64}$")
	exchangeCountry    = regexp.MustCompile("^[A-Z]{2}$")
	exchangeService    = regexp.MustCompile("^[a-zA-Z0-9_-]{1,100}$")
)

type exchangeProduct struct {
	Type      string `json:"type"`
	Name      string `json:"name"`
	Available *int   `json:"available,omitempty"`
}

type exchangeCatalog struct {
	Configured   bool              `json:"configured"`
	OrderingOpen bool              `json:"ordering_open"`
	Products     []exchangeProduct `json:"products"`
}

type exchangeShopOrder struct {
	ID                  string `json:"id"`
	Type                string `json:"type"`
	Name                string `json:"name"`
	Status              string `json:"status"`
	PaymentInstructions string `json:"payment_instructions"`
	PaymentDeadline     string `json:"payment_deadline,omitempty"`
	Delivery            *struct {
		Key string `json:"key"`
	} `json:"delivery,omitempty"`
}

type exchangeSMSOrder struct {
	ID        string `json:"id"`
	Status    string `json:"status"`
	Phone     string `json:"phone_number,omitempty"`
	Code      string `json:"sms_code,omitempty"`
	ExpiresAt string `json:"expires_at,omitempty"`
	CanRetry  bool   `json:"can_retry"`
}

func exchangeOrigin(setting string) *url.URL {
	origin, err := url.Parse(strings.TrimSpace(os.Getenv(setting)))
	if err != nil || origin.Scheme != "https" || origin.Hostname() == "" ||
		origin.User != nil || origin.RawQuery != "" || origin.ForceQuery || origin.Fragment != "" || origin.RawPath != "" ||
		(origin.Path != "" && origin.Path != "/") {
		return nil
	}
	return origin
}

// exchangeRequest sends only credentials scoped to the exchange order. The
// dashboard Authorization header, cookies, and upstream error bodies stay local.
func exchangeRequest[T any](ctx context.Context, origin *url.URL, method, path, bearer string, body any) (T, int, string) {
	var empty T
	if origin == nil {
		return empty, http.StatusServiceUnavailable, ""
	}
	var content io.Reader
	if body != nil {
		encoded, err := common.Marshal(body)
		if err != nil {
			return empty, http.StatusBadGateway, ""
		}
		content = bytes.NewReader(encoded)
	}
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(origin.String(), "/")+path, content)
	if err != nil {
		return empty, http.StatusBadGateway, ""
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "Allfun.api Exchange/1.0")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if bearer != "" {
		request.Header.Set("Authorization", "Bearer "+bearer)
	}
	client := http.DefaultClient
	if configured := service.GetSSRFProtectedHTTPClient(); configured != nil {
		client = configured
	}
	transport := *client
	transport.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := transport.Do(request)
	if err != nil {
		return empty, http.StatusBadGateway, ""
	}
	defer response.Body.Close()
	var result struct {
		Data  *T   `json:"data"`
		Code  *int `json:"code"`
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	payload, err := io.ReadAll(io.LimitReader(response.Body, exchangeResponseLimit+1))
	if err != nil || len(payload) > exchangeResponseLimit || common.Unmarshal(payload, &result) != nil {
		return empty, http.StatusBadGateway, ""
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return empty, response.StatusCode, result.Error.Code
	}
	if result.Data == nil || (result.Code != nil && *result.Code != 0) {
		return empty, http.StatusBadGateway, ""
	}
	return *result.Data, http.StatusOK, ""
}

func writeExchangeResult[T any](c *gin.Context, data T, status int, code string) {
	if status == http.StatusOK {
		common.ApiSuccess(c, data)
		return
	}
	key := "The exchange service is unavailable."
	switch {
	case code == "ALREADY_USED":
		key = "This exchange key has already been used."
	case code == "SHOP_NOT_READY":
		key = "Key purchases are temporarily closed."
	case code == "OUT_OF_STOCK" || code == "SERVICE_NOT_AVAILABLE":
		key = "Out of stock"
	case status == http.StatusUnauthorized || code == "KEY_NOT_BOUND":
		status, key = http.StatusUnprocessableEntity, "Invalid or expired exchange key."
	case code == "CANCEL_TOO_EARLY":
		key = "Wait two minutes before cancelling this SMS order."
	case status == http.StatusNotFound:
		key = "Exchange order or key not found."
	case status == http.StatusTooManyRequests:
		key = "Too many requests. Please try again later."
	case status >= 400 && status < 500:
		key = "Invalid request"
	default:
		status = http.StatusBadGateway
	}
	common.ApiErrorStatus(c, status, common.NewMessage(key))
}

func getExchangePayload(c *gin.Context, payload any) bool {
	if c.ContentType() == "application/json" {
		body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 4096))
		if err == nil && common.Unmarshal(body, payload) == nil {
			return true
		}
	}
	common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid request"))
	return false
}

func GetExchangeProducts(c *gin.Context) {
	origin := exchangeOrigin(exchangeShopURL)
	if origin == nil {
		common.ApiSuccess(c, exchangeCatalog{Products: []exchangeProduct{}})
		return
	}
	catalog, status, code := exchangeRequest[exchangeCatalog](c.Request.Context(), origin, http.MethodGet, "/api/shop/products", "", nil)
	catalog.Configured = true
	writeExchangeResult(c, catalog, status, code)
}

func exchangeOrderReceipt(userID int, orderID string) string {
	return common.GenerateHMAC("exchange-order-receipt:v1:" + strconv.Itoa(userID) + ":" + orderID)
}

func CreateExchangeOrder(c *gin.Context) {
	var payload struct {
		ID   string `json:"id"`
		Type string `json:"type"`
		Name string `json:"name"`
	}
	if !getExchangePayload(c, &payload) {
		return
	}
	payload.Name = strings.TrimSpace(payload.Name)
	if !exchangeOrderID.MatchString(payload.ID) ||
		(payload.Type != "membership" && (payload.Type != "sms" || payload.Name != exchangeSMSProduct)) ||
		payload.Name == "" || utf8.RuneCountInString(payload.Name) > 80 {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid request"))
		return
	}
	body := gin.H{"id": payload.ID, "type": payload.Type, "name": payload.Name,
		"receipt_token": exchangeOrderReceipt(c.GetInt("id"), payload.ID)}
	order, status, code := exchangeRequest[exchangeShopOrder](c.Request.Context(), exchangeOrigin(exchangeShopURL), http.MethodPost, "/api/shop/orders", "", body)
	writeExchangeResult(c, order, status, code)
}

func GetExchangeOrder(c *gin.Context) {
	id := c.Param("id")
	if !exchangeOrderID.MatchString(id) {
		common.ApiErrorStatus(c, http.StatusNotFound, common.NewMessage("Exchange order or key not found."))
		return
	}
	order, status, code := exchangeRequest[exchangeShopOrder](c.Request.Context(), exchangeOrigin(exchangeShopURL),
		http.MethodGet, "/api/shop/orders/"+id, exchangeOrderReceipt(c.GetInt("id"), id), nil)
	writeExchangeResult(c, order, status, code)
}

func RedeemExchangeMembership(c *gin.Context) {
	var payload struct {
		Key        string `json:"key"`
		ClaimNonce string `json:"claim_nonce"`
	}
	if !getExchangePayload(c, &payload) {
		return
	}
	payload.Key = strings.ToLower(strings.TrimSpace(payload.Key))
	if !exchangeMemberKey.MatchString(payload.Key) || !exchangeNonce.MatchString(payload.ClaimNonce) {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid or expired exchange key."))
		return
	}
	result, status, code := exchangeRequest[struct {
		Name    string `json:"name"`
		Content string `json:"content"`
	}](c.Request.Context(), exchangeOrigin(exchangeShopURL), http.MethodPost, "/api/shop/redeem", "", payload)
	writeExchangeResult(c, result, status, code)
}

func ActivateExchangeSMS(c *gin.Context) {
	var payload struct {
		Key        string `json:"key"`
		ClaimToken string `json:"claim_token"`
	}
	if !getExchangePayload(c, &payload) {
		return
	}
	payload.Key = strings.ToLower(strings.TrimSpace(payload.Key))
	if !exchangeSMSKey.MatchString(payload.Key) || !exchangeSMSSession.MatchString(payload.ClaimToken) {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid or expired exchange key."))
		return
	}
	result, status, code := exchangeRequest[struct {
		Session   string `json:"session"`
		ExpiresIn int    `json:"expires_in"`
	}](c.Request.Context(), exchangeOrigin(exchangeShopURL), http.MethodPost, "/api/activate", payload.Key,
		gin.H{"claim_token": payload.ClaimToken})
	writeExchangeResult(c, result, status, code)
}

func exchangeSMSAuth(c *gin.Context) string {
	session := c.GetHeader("X-Exchange-Session")
	if !exchangeSMSSession.MatchString(session) {
		common.ApiErrorStatus(c, http.StatusUnprocessableEntity, common.NewMessage("Invalid or expired exchange key."))
		return ""
	}
	return session
}

func GetExchangeSMSCountries(c *gin.Context) {
	session := exchangeSMSAuth(c)
	if session == "" {
		return
	}
	countries, status, code := exchangeRequest[[]struct {
		Code string `json:"code"`
		Name string `json:"name"`
	}](c.Request.Context(), exchangeOrigin(exchangeShopURL), http.MethodGet, "/api/catalog/countries", session, nil)
	writeExchangeResult(c, countries, status, code)
}

func GetExchangeSMSServices(c *gin.Context) {
	session := exchangeSMSAuth(c)
	if session == "" {
		return
	}
	country := c.Query("country")
	if !exchangeCountry.MatchString(country) {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid request"))
		return
	}
	services, status, code := exchangeRequest[[]struct {
		Code string `json:"service_code"`
		Name string `json:"service_name"`
	}](c.Request.Context(), exchangeOrigin(exchangeShopURL), http.MethodGet, "/api/catalog/prices?country_code="+country, session, nil)
	writeExchangeResult(c, services, status, code)
}

func CreateExchangeSMSOrder(c *gin.Context) {
	session := exchangeSMSAuth(c)
	if session == "" {
		return
	}
	var payload struct {
		Country string `json:"country_code"`
		Service string `json:"service_code"`
	}
	if !getExchangePayload(c, &payload) {
		return
	}
	if !exchangeCountry.MatchString(payload.Country) || !exchangeService.MatchString(payload.Service) {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid request"))
		return
	}
	order, status, code := exchangeRequest[exchangeSMSOrder](c.Request.Context(), exchangeOrigin(exchangeShopURL), http.MethodPost, "/api/redeem", session, payload)
	writeExchangeResult(c, order, status, code)
}

func GetExchangeSMSOrder(c *gin.Context) {
	exchangeSMSOrderAction(c, http.MethodGet, "")
}

func CancelExchangeSMSOrder(c *gin.Context) {
	exchangeSMSOrderAction(c, http.MethodPost, "/cancel")
}

func RetryExchangeSMSOrder(c *gin.Context) {
	exchangeSMSOrderAction(c, http.MethodPost, "/retry")
}

func exchangeSMSOrderAction(c *gin.Context, method, suffix string) {
	session := exchangeSMSAuth(c)
	if session == "" {
		return
	}
	id := c.Param("id")
	if !exchangeOrderID.MatchString(id) {
		common.ApiErrorStatus(c, http.StatusNotFound, common.NewMessage("Exchange order or key not found."))
		return
	}
	order, status, code := exchangeRequest[exchangeSMSOrder](c.Request.Context(), exchangeOrigin(exchangeShopURL), method,
		"/api/orders/"+id+suffix, session, nil)
	writeExchangeResult(c, order, status, code)
}
