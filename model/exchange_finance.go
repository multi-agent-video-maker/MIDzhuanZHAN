package model

import (
	"context"

	"gorm.io/gorm/clause"
)

// ExchangeOrderAmounts records the operator's actual receipts and acquisition
// costs in USD cents. A missing amount is distinct from an explicit zero.
type ExchangeOrderAmounts struct {
	OrderID      string `gorm:"type:varchar(36);primaryKey"`
	RevenueCents *int64
	CostCents    *int64
	UpdatedBy    int
	UpdatedAt    int64
}

func ListExchangeOrderAmounts(ctx context.Context, ids []string) ([]ExchangeOrderAmounts, error) {
	var entries []ExchangeOrderAmounts
	if len(ids) == 0 {
		return entries, nil
	}
	err := DB.WithContext(ctx).Where("order_id IN ?", ids).Find(&entries).Error
	return entries, err
}

func SaveExchangeOrderAmounts(ctx context.Context, entry ExchangeOrderAmounts) error {
	return DB.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "order_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"revenue_cents", "cost_cents", "updated_by", "updated_at"}),
	}).Create(&entry).Error
}
