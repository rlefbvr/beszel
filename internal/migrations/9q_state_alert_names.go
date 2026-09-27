package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds an optional name to the state rules, shown with them in the interface.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("state_alerts")
		if err != nil {
			return err
		}
		if collection.Fields.GetByName("name") != nil {
			return nil
		}
		collection.Fields.Add(&core.TextField{Name: "name", Max: 100})
		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("state_alerts")
		if err != nil {
			return err
		}
		collection.Fields.RemoveByName("name")
		return app.Save(collection)
	})
}
