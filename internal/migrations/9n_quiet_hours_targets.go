package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds the services and containers a quiet hours window can be limited to,
// chosen from the selection of the services and containers pages:
// [{"kind": "service" | "container", "name": "nginx"}].
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("quiet_hours")
		if err != nil {
			return err
		}
		if collection.Fields.GetByName("targets") == nil {
			collection.Fields.Add(&core.JSONField{Name: "targets", MaxSize: 50000})
		}
		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("quiet_hours")
		if err != nil {
			return err
		}
		collection.Fields.RemoveByName("targets")
		return app.Save(collection)
	})
}
