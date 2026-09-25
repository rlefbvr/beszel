package migrations

import (
	"slices"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// statsCollections store their records by aggregation type ("1m" to "480m").
var statsCollections = []string{"system_stats", "container_stats", "network_monitor_stats"}

// Adds the chart periods offered to the users (hub settings) and the daily
// aggregation type "1440m", kept for the long periods (90 days to 1 year).
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId(hubSettingsCollection)
		if err != nil {
			return err
		}
		collection.Fields.Add(&core.JSONField{Name: "chart_periods", MaxSize: 2000})
		if err := app.Save(collection); err != nil {
			return err
		}
		record, err := app.FindRecordById(hubSettingsCollection, hubSettingsRecordID)
		if err != nil {
			return err
		}
		record.Set("chart_periods", []string{"1m", "1h", "12h", "24h", "1w", "30d"})
		if err := app.Save(record); err != nil {
			return err
		}
		return setStatsTypes(app, func(values []string) []string {
			if slices.Contains(values, "1440m") {
				return values
			}
			return append(values, "1440m")
		})
	}, func(app core.App) error {
		for _, name := range statsCollections {
			if _, err := app.DB().NewQuery("DELETE FROM " + name + " WHERE type = '1440m'").Execute(); err != nil {
				return err
			}
		}
		if err := setStatsTypes(app, func(values []string) []string {
			return slices.DeleteFunc(values, func(value string) bool { return value == "1440m" })
		}); err != nil {
			return err
		}
		collection, err := app.FindCollectionByNameOrId(hubSettingsCollection)
		if err != nil {
			return nil
		}
		collection.Fields.RemoveByName("chart_periods")
		return app.Save(collection)
	})
}

// setStatsTypes changes the values of the type field of the stats collections.
func setStatsTypes(app core.App, change func([]string) []string) error {
	for _, name := range statsCollections {
		collection, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			return err
		}
		field, ok := collection.Fields.GetByName("type").(*core.SelectField)
		if !ok {
			continue
		}
		field.Values = change(field.Values)
		if err := app.Save(collection); err != nil {
			return err
		}
	}
	return nil
}
