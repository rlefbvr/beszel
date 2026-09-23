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
