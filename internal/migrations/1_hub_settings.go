package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

const (
	hubSettingsCollection = "hub_settings"
	hubSettingsRecordID   = "hubsettings0000"
)

// Adds the hub_settings collection, a single record of hub-wide settings
// readable by authenticated users and editable by admins.
func init() {
	m.Register(func(app core.App) error {
		collection := core.NewBaseCollection(hubSettingsCollection)
		collection.ListRule = types.Pointer(`@request.auth.id != ""`)
		collection.ViewRule = types.Pointer(`@request.auth.id != ""`)
		collection.UpdateRule = types.Pointer(`@request.auth.role = "admin"`)
		collection.Fields.Add(&core.NumberField{
			Name:     "services_interval",
			Required: true,
			OnlyInt:  true,
			Min:      types.Pointer(1.0),
			Max:      types.Pointer(60.0),
		})
		collection.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
		if err := app.Save(collection); err != nil {
			return err
		}

		record := core.NewRecord(collection)
		record.Id = hubSettingsRecordID
		// service collection interval in minutes
		record.Set("services_interval", 10)
		return app.Save(record)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId(hubSettingsCollection)
		if err != nil {
			return nil
		}
		return app.Delete(collection)
	})
}
