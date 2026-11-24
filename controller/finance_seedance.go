package controller

import (
	"context"
	"io"
	"maps"
	"math"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	seedanceRelayOrigin  = "https://rongli.rongliantz.cn"
	seedanceFinancePath  = "/api/v3/contents/generations/tasks"
	seedanceFinanceLimit = 200
)

var seedanceRelayModels = []string{"doubao-seedance-2-0-260128", "doubao-seedance-2-5-260628"}

type seedanceFinanceLog struct {
	Type  int    `json:"type"`
	Model string `json:"model_name"`
	Quota int64  `json:"quota"`
	Other string `json:"other"`
}

type seedanceFinanceRecord struct {
	ID           string  `json:"id"`
	Model        string  `json:"model"`
	Port         string  `json:"port"`
	UserID       int     `json:"userId,omitempty"`
	Username     string  `json:"username,omitempty"`
	SettledAt    int64   `json:"settledAt,omitempty"`
	OutputTokens int     `json:"outputTokens"`
	FixedCost    float64 `json:"fixedCost"`
	Revenue      float64 `json:"revenue"`
}

type seedanceFinanceLedger struct {
	Configured bool                    `json:"configured"`
	Records    []seedanceFinanceRecord `json:"records"`
	Pending    int                     `json:"pending"`
	Limited    bool                    `json:"limited"`
}

func GetSeedanceFinance(c *gin.Context) {
	configuredIDs := strings.TrimSpace(os.Getenv("ALLFUN_SEEDANCE_CHANNEL_IDS"))
	if configuredIDs == "" {
		configuredIDs = strings.TrimSpace(os.Getenv("ALLFUN_SEEDANCE_CHANNEL_ID"))
	}
	if configuredIDs == "" {
		common.ApiSuccess(c, seedanceFinanceLedger{Records: []seedanceFinanceRecord{}})
		return
	}

	var channelIDs []int
	var ledgerKey string
	for rawID := range strings.SplitSeq(configuredIDs, ",") {
		channelID, err := strconv.Atoi(strings.TrimSpace(rawID))
		if err != nil || channelID <= 0 {
			common.ApiErrorStatus(c, http.StatusServiceUnavailable, common.NewMessage("Refresh failed"))
			return
		}
		channel, err := model.GetChannelById(channelID, true)
		if err != nil || channel == nil ||
			strings.TrimRight(channel.GetBaseURL(), "/") != seedanceRelayOrigin ||
			channel.ChannelInfo.IsMultiKey || !strings.HasPrefix(channel.Key, "sk-") ||
			strings.ContainsAny(channel.Key, " \r\n\t") ||
			(ledgerKey != "" && channel.Key != ledgerKey) {
			common.ApiErrorStatus(c, http.StatusServiceUnavailable, common.NewMessage("Refresh failed"))
			return
		}
		ledgerKey = channel.Key
		channelIDs = append(channelIDs, channelID)
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 12*time.Second)
	defer cancel()
	tasks, err := settledSeedanceFinanceTasks(ctx, model.DB, channelIDs)
	if err != nil {
		common.ApiErrorStatus(c, http.StatusServiceUnavailable, common.NewMessage("Refresh failed"))
		return
	}
	if len(tasks) == 0 {
		common.ApiSuccess(c, seedanceFinanceLedger{Configured: true, Records: []seedanceFinanceRecord{}})
		return
	}

	var upstreamStatus struct {
		Success bool `json:"success"`
		Data    struct {
			DisplayType  string  `json:"quota_display_type"`
			QuotaPerUnit float64 `json:"quota_per_unit"`
			ExchangeRate float64 `json:"usd_exchange_rate"`
		} `json:"data"`
	}
	var upstreamLogs struct {
		Success bool                 `json:"success"`
		Data    []seedanceFinanceLog `json:"data"`
	}
	if !readSeedanceRelayJSON(ctx, "/api/status", "", &upstreamStatus) ||
		!upstreamStatus.Success || upstreamStatus.Data.DisplayType != "CNY" ||
		!(upstreamStatus.Data.QuotaPerUnit > 0) || !(upstreamStatus.Data.ExchangeRate > 0) ||
		!(operation_setting.USDExchangeRate > 0) || !(common.QuotaPerUnit > 0) ||
		!readSeedanceRelayJSON(ctx, "/api/log/token", ledgerKey, &upstreamLogs) ||
		!upstreamLogs.Success {
		common.ApiErrorStatus(c, http.StatusBadGateway, common.NewMessage("Refresh failed"))
		return
	}

	ledger := reconcileSeedanceFinance(
		tasks[:min(len(tasks), seedanceFinanceLimit)], upstreamLogs.Data,
		common.QuotaPerUnit, upstreamStatus.Data.QuotaPerUnit/upstreamStatus.Data.ExchangeRate,
		operation_setting.USDExchangeRate,
	)
	if err := loadSeedanceFinanceUsernames(ctx, model.DB, ledger.Records); err != nil {
		common.SysError(common.LogText("Failed to load finance usernames: %s", err.Error()))
	}
	ledger.Limited = len(tasks) > seedanceFinanceLimit
	common.ApiSuccess(c, ledger)
}

func settledSeedanceFinanceTasks(ctx context.Context, db *gorm.DB, channelIDs []int) ([]*model.Task, error) {
	var tasks []*model.Task
	err := db.WithContext(ctx).
		Select("task_id", "properties", "private_data", "quota", "user_id", "finish_time").
		Where("channel_id IN ? AND status = ?", channelIDs, model.TaskStatusSuccess).
		Order("id DESC").
		Limit(seedanceFinanceLimit + 1).
		Find(&tasks).Error
	return tasks, err
}

func loadSeedanceFinanceUsernames(ctx context.Context, db *gorm.DB, records []seedanceFinanceRecord) error {
	ids := make(map[int]struct{})
	for _, record := range records {
		if record.UserID > 0 {
			ids[record.UserID] = struct{}{}
		}
	}
	if len(ids) == 0 {
		return nil
	}

	var users []model.User
	if err := db.WithContext(ctx).Select("id", "username").
		Where("id IN ?", slices.Collect(maps.Keys(ids))).Find(&users).Error; err != nil {
		return err
	}
	usernames := make(map[int]string, len(users))
	for _, user := range users {
		usernames[user.Id] = user.Username
	}
	for i := range records {
		records[i].Username = usernames[records[i].UserID]
	}
	return nil
}

func readSeedanceRelayJSON(ctx context.Context, path, key string, result any) bool {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, seedanceRelayOrigin+path, nil)
	if err != nil {
		return false
	}
	if key != "" {
		request.Header.Set("Authorization", "Bearer "+key)
	}
	// Keep the dedicated channel key on the intended endpoint.
	client := *service.GetSSRFProtectedHTTPClient()
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := client.Do(request)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	return response.StatusCode == http.StatusOK && common.DecodeJson(io.LimitReader(response.Body, 8<<20), result) == nil
}

func reconcileSeedanceFinance(tasks []*model.Task, logs []seedanceFinanceLog, localUnit, upstreamUnit, exchange float64) seedanceFinanceLedger {
	type chargeKey struct{ task, model string }
	type charge struct {
		quota      int64
		tokens     int
		hasConsume bool
	}
	charges := make(map[chargeKey]charge, len(logs))
	for _, entry := range logs {
		if (entry.Type != model.LogTypeConsume && entry.Type != model.LogTypeRefund) ||
			entry.Quota < 0 || entry.Quota > math.MaxInt32 || !slices.Contains(seedanceRelayModels, entry.Model) {
			continue
		}
		var details struct {
			TaskID string `json:"task_id"`
			Usage  struct {
				Tokens int `json:"tokens"`
			} `json:"usage_facts"`
		}
		if common.UnmarshalJsonStr(entry.Other, &details) != nil || details.TaskID == "" {
			continue
		}
		key := chargeKey{details.TaskID, entry.Model}
		balance := charges[key]
		if entry.Type == model.LogTypeRefund {
			balance.quota -= entry.Quota
		} else {
			balance.quota += entry.Quota
			balance.hasConsume = true
		}
		balance.tokens = max(balance.tokens, details.Usage.Tokens)
		charges[key] = balance
	}

	ledger := seedanceFinanceLedger{Configured: true, Records: make([]seedanceFinanceRecord, 0, len(tasks))}
	for _, task := range tasks {
		name := task.Properties.OriginModelName
		if !slices.Contains(seedanceRelayModels, name) {
			continue
		}
		cost := charges[chargeKey{task.PrivateData.UpstreamTaskID, name}]
		if !cost.hasConsume || cost.quota < 0 {
			ledger.Pending++
			continue
		}
		port := seedanceFinancePath
		if execution := task.PrivateData.Execution; execution != nil && execution.RequestPath != "" {
			port = execution.RequestPath
		}
		ledger.Records = append(ledger.Records, seedanceFinanceRecord{
			ID: "seedance:" + task.TaskID, Model: name, Port: port,
			UserID: task.UserId, SettledAt: task.FinishTime,
			OutputTokens: cost.tokens, FixedCost: float64(cost.quota) / upstreamUnit / exchange,
			Revenue: float64(task.Quota) / localUnit,
		})
	}
	return ledger
}
