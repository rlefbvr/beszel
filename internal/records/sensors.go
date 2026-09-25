package records

import (
	"time"

	"github.com/henrygd/beszel/internal/hub/hubsettings"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// sensorStats sums the probes of sensor_stats records.
type sensorStats struct {
	Count        int     `db:"count"`
	TotalCount   int64   `db:"total_count"`
	SuccessCount int64   `db:"success_count"`
	ResponseSum  int64   `db:"res_sum"`
	ResMin       float64 `db:"res_min"`
	ResMax       float64 `db:"res_max"`
}

// createLongerSensorRecords sums the stats of each sensor check into the longer
// types, like the network monitor stats.
func createLongerSensorRecords(txApp core.App, now time.Time, longerRecordData []LongerRecordData) error {
	collection, err := txApp.FindCachedCollectionByNameOrId("sensor_stats")
	if err != nil {
		return err
	}
	var checks []struct {
		Id     string `db:"id"`
		Sensor string `db:"sensor"`
	}
	db := txApp.DB()
	if err := db.NewQuery("SELECT id, sensor FROM sensor_checks").All(&checks); err != nil {
		return err
	}
	for _, check := range checks {
		for _, recordData := range longerRecordData {
			longerRecordPeriod := now.Add(recordData.longerTimeDuration + time.Minute)
			shorterRecordPeriod := now.Add(recordData.longerTimeDuration)
			if recordData.longerType != "10m" {
				count, err := txApp.CountRecords(collection.Id, dbx.NewExp(
					"`check`={:check} AND type={:type} AND created>{:created}",
					dbx.Params{"check": check.Id, "type": recordData.longerType, "created": longerRecordPeriod.UnixMilli()},
				))
				if err != nil {
					return err
				}
				if count > 0 {
					continue
				}
			}
			var stats sensorStats
			err := db.Select(
				"COUNT(*) AS count",
				"COALESCE(SUM(total_count), 0) AS total_count",
				"COALESCE(SUM(success_count), 0) AS success_count",
				"COALESCE(SUM(res_sum), 0) AS res_sum",
				"COALESCE(MIN(CASE WHEN success_count > 0 THEN res_min END), 0) AS res_min",
				"COALESCE(MAX(CASE WHEN success_count > 0 THEN res_max END), 0) AS res_max",
			).From("sensor_stats").Where(dbx.NewExp(
				"`check`={:check} AND type={:type} AND created>{:created}",
				dbx.Params{"check": check.Id, "type": recordData.shorterType, "created": shorterRecordPeriod.UnixMilli()},
			)).One(&stats)
			if err != nil {
				txApp.Logger().Error("failed to sum sensor stats", "check", check.Id, "err", err)
				continue
			}
			if stats.Count == 0 {
				continue
			}
			record := core.NewRecord(collection)
			record.Set("sensor", check.Sensor)
			record.Set("check", check.Id)
			record.Set("type", recordData.longerType)
			record.Set("created", now.UnixMilli())
			record.Set("total_count", stats.TotalCount)
			record.Set("success_count", stats.SuccessCount)
			record.Set("res_sum", stats.ResponseSum)
			record.Set("res_min", stats.ResMin)
			record.Set("res_max", stats.ResMax)
			if err := txApp.SaveNoValidate(record); err != nil {
				txApp.Logger().Error("failed to save sensor longer record", "err", err)
			}
		}
	}
	return nil
}

// deleteOldSensorIncidents deletes the ended interruptions older than the
// longest chart period, and at least 30 days.
func deleteOldSensorIncidents(app core.App) error {
	retention := max(30*24*time.Hour, hubsettings.DailyRetention(app))
	before := time.Now().UTC().Add(-retention)
	_, err := app.DB().NewQuery("DELETE FROM sensor_incidents WHERE `end` != '' AND `end` < {:before}").
		Bind(dbx.Params{"before": before.Format("2006-01-02 15:04:05.000Z")}).Execute()
	return err
}
