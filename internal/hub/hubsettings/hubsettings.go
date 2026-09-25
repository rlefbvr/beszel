// Package hubsettings reads hub-wide settings stored in the hub_settings collection.
package hubsettings

import (
	"sync/atomic"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

const (
	CollectionName = "hub_settings"
	// RecordID is the id of the single settings record created by migration.
	RecordID = "hubsettings0000"
	// DefaultServicesInterval is used when the settings record is unavailable.
	DefaultServicesInterval = 10 * time.Minute
	// DefaultAlertsRetentionCount is the number of alerts kept per user when
	// the settings record is unavailable.
	DefaultAlertsRetentionCount = 200
)

// servicesIntervalMinutes caches the interval; 0 means not loaded yet.
var servicesIntervalMinutes atomic.Int64

// ServicesInterval returns how often agents collect service (systemd / Windows) data.
func ServicesInterval(app core.App) time.Duration {
	if minutes := servicesIntervalMinutes.Load(); minutes > 0 {
		return time.Duration(minutes) * time.Minute
	}
	record, err := app.FindRecordById(CollectionName, RecordID)
	if err != nil {
		return DefaultServicesInterval
	}
	return cacheRecord(record)
}

func cacheRecord(record *core.Record) time.Duration {
	minutes := int64(record.GetInt("services_interval"))
	if minutes < 1 {
		minutes = int64(DefaultServicesInterval / time.Minute)
	}
	servicesIntervalMinutes.Store(minutes)
	return time.Duration(minutes) * time.Minute
}

// BindEvents keeps the cached settings in sync when the record is updated.
func BindEvents(app core.App) {
	app.OnRecordAfterUpdateSuccess(CollectionName).BindFunc(func(e *core.RecordEvent) error {
		cacheRecord(e.Record)
		return e.Next()
	})
}

// AlertsRetention returns how long the alert history is kept: a number of
// alerts per user, or a number of days when days > 0 (then count is ignored).
func AlertsRetention(app core.App) (count, days int) {
	record, err := app.FindRecordById(CollectionName, RecordID)
	if err != nil {
		return DefaultAlertsRetentionCount, 0
	}
	count = record.GetInt("alerts_retention_count")
	if count < 1 {
		count = DefaultAlertsRetentionCount
	}
	return count, max(record.GetInt("alerts_retention_days"), 0)
}

// longPeriodDays are the chart periods kept with the daily aggregation "1440m".
var longPeriodDays = map[string]int{"90d": 90, "180d": 180, "1y": 365}

// DailyRetention returns how long the daily records are kept: the longest chart
// period enabled beyond 30 days, or 0 when none is (no daily records).
func DailyRetention(app core.App) time.Duration {
	record, err := app.FindRecordById(CollectionName, RecordID)
	if err != nil {
		return 0
	}
	var periods []string
	if err := record.UnmarshalJSONField("chart_periods", &periods); err != nil {
		return 0
	}
	days := 0
	for _, period := range periods {
		days = max(days, longPeriodDays[period])
	}
	return time.Duration(days) * 24 * time.Hour
}
