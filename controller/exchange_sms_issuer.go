package controller

import (
	"net/http"
	"os"
	"strings"
	"unicode/utf16"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

const (
	exchangeSMSIssueURL = "ALLFUN_EXCHANGE_SMS_ISSUE_URL"
	exchangeSMSIssueKey = "ALLFUN_EXCHANGE_SMS_ISSUE_KEY"
)

// IssueExchangeSMSKey issues one voucher through the SMS service. Retrying the
// same request within this administrator's session uses the same issuance ID.
func IssueExchangeSMSKey(c *gin.Context) {
	var payload struct {
		RequestID string `json:"request_id"`
		Name      string `json:"name"`
		IssuerID  int    `json:"issuer_id"`
	}
	if !getExchangePayload(c, &payload) {
		return
	}
	payload.Name = strings.TrimSpace(payload.Name)
	payload.IssuerID = c.GetInt("id")
	if !exchangeOrderID.MatchString(payload.RequestID) || payload.Name == "" || len(utf16.Encode([]rune(payload.Name))) > 50 {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid request"))
		return
	}
	origin := exchangeOrigin(exchangeSMSIssueURL)
	secret := strings.TrimSpace(os.Getenv(exchangeSMSIssueKey))
	type issuedKey struct {
		ID  string `json:"id"`
		Key string `json:"key"`
	}
	if origin == nil || !exchangeNonce.MatchString(secret) {
		writeExchangeResult(c, issuedKey{}, http.StatusBadGateway, "")
		return
	}
	result, status, code := exchangeRequest[issuedKey](c.Request.Context(), origin, http.MethodPost, "/api/sms/keys", secret, payload)
	switch {
	case status == http.StatusOK && result.ID == payload.RequestID && exchangeSMSKey.MatchString(result.Key):
		common.ApiSuccess(c, result)
	case status == http.StatusConflict && code == "ALREADY_USED":
		common.ApiErrorStatus(c, status, common.NewMessage("This exchange key has already been used."))
	case status == http.StatusConflict && code == "IDEMPOTENCY_CONFLICT":
		common.ApiErrorStatus(c, status, common.NewMessage("Invalid request"))
	case status == http.StatusTooManyRequests:
		writeExchangeResult(c, issuedKey{}, status, "")
	default:
		writeExchangeResult(c, issuedKey{}, http.StatusBadGateway, "")
	}
}
