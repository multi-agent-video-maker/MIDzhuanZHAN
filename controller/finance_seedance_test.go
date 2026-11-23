package controller

import (
	"os"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestSeedanceFinanceSelectsOnlySettledChannelTasks(t *testing.T) {
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
			require.NoError(t, db.AutoMigrate(&model.Task{}))
			tx := db.Begin()
			require.NoError(t, tx.Error)
			defer tx.Rollback()
			require.NoError(t, tx.Create(&[]model.Task{
				{TaskID: "finance-settled", ChannelId: 2187, Status: model.TaskStatusSuccess, Quota: 400, PrivateData: model.TaskPrivateData{UpstreamTaskID: "provider-settled"}},
				{TaskID: "finance-queued", ChannelId: 2187, Status: model.TaskStatusQueued},
				{TaskID: "finance-other", ChannelId: 2190, Status: model.TaskStatusSuccess},
			}).Error)
			tasks, err := settledSeedanceFinanceTasks(t.Context(), tx, 2187)
			require.NoError(t, err)
			require.Len(t, tasks, 1)
			assert.Equal(t, "finance-settled", tasks[0].TaskID)
			assert.Equal(t, "provider-settled", tasks[0].PrivateData.UpstreamTaskID)
			assert.Equal(t, 400, tasks[0].Quota)
		})
	}
}

func TestSeedanceFinanceMatchesByTaskAndNetsRefunds(t *testing.T) {
	const modelName = "doubao-seedance-2-0-260128"
	tasks := []*model.Task{
		{TaskID: "local-a", Quota: 200000, Properties: model.Properties{OriginModelName: modelName}, PrivateData: model.TaskPrivateData{
			UpstreamTaskID: "up-a", Execution: &model.TaskExecutionSnapshot{RequestPath: "/v1/videos"},
		}},
		{TaskID: "local-b", Quota: 200000, Properties: model.Properties{OriginModelName: modelName}, PrivateData: model.TaskPrivateData{UpstreamTaskID: "up-b"}},
	}
	logs := []seedanceFinanceLog{
		{Type: model.LogTypeConsume, Model: modelName, Quota: 1500000, Other: `{"task_id":"up-a","usage_facts":{"tokens":50000}}`},
		{Type: model.LogTypeRefund, Model: modelName, Quota: 50000, Other: `{"task_id":"up-a"}`},
		{Type: model.LogTypeConsume, Model: modelName, Quota: 4000000, Other: `{"task_id":"another-task"}`},
	}

	ledger := reconcileSeedanceFinance(tasks, logs, 500000, 500000, 7.25)
	require.Len(t, ledger.Records, 1)
	assert.Equal(t, 1, ledger.Pending)
	assert.Equal(t, "seedance:local-a", ledger.Records[0].ID)
	assert.Equal(t, "/v1/videos", ledger.Records[0].Port)
	assert.Equal(t, 50000, ledger.Records[0].OutputTokens)
	assert.InDelta(t, 0.4, ledger.Records[0].Revenue, 0.000001)
	assert.InDelta(t, 0.4, ledger.Records[0].FixedCost, 0.000001)
}
