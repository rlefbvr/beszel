package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds the scope of a quiet hours window: the alert types (CPU, Status…) and
// the service or container state rules it silences; all the alerts when both
// are empty.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("quiet_hours")
		if err != nil {
			return err
		}
		stateAlerts, err := app.FindCollectionByNameOrId(stateAlertsCollection)
		if err != nil {
			return err
		}
		if collection.Fields.GetByName("alerts") == nil {
			collection.Fields.Add(&core.JSONField{Name: "alerts", MaxSize: 2000})
		}
		if collection.Fields.GetByName("rules") == nil {
			collection.Fields.Add(&core.RelationField{Name: "rules", CollectionId: stateAlerts.Id, MaxSelect: 100})
		}
		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("quiet_hours")
		if err != nil {
			return err
		}
		collection.Fields.RemoveByName("alerts")
		collection.Fields.RemoveByName("rules")
		return app.Save(collection)
	})
}
