package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Adds the retention of the alert history: a number of alerts kept per user
// (200 by default, as before), or a number of days when set.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId(hubSettingsCollection)
		if err != nil {
			return err
		}
		collection.Fields.Add(&core.NumberField{
			Name:    "alerts_retention_count",
			OnlyInt: true,
			Min:     types.Pointer(10.0),
			Max:     types.Pointer(100000.0),
		})
		collection.Fields.Add(&core.NumberField{
			Name:    "alerts_retention_days",
			OnlyInt: true,
			Min:     types.Pointer(0.0),
			Max:     types.Pointer(3650.0),
		})
		if err := app.Save(collection); err != nil {
			return err
		}
		record, err := app.FindRecordById(hubSettingsCollection, hubSettingsRecordID)
		if err != nil {
			return err
		}
		record.Set("alerts_retention_count", 200)
		record.Set("alerts_retention_days", 0)
		return app.Save(record)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId(hubSettingsCollection)
		if err != nil {
			return nil
		}
		collection.Fields.RemoveByName("alerts_retention_count")
		collection.Fields.RemoveByName("alerts_retention_days")
		return app.Save(collection)
	})
}
