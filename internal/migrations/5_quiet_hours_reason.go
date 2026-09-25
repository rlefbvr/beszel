package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds the reason of a quiet hours window: a preset key (for example
// "maintenance", translated by the UI) or a custom text.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("quiet_hours")
		if err != nil {
			return err
		}
		collection.Fields.Add(&core.TextField{Name: "reason", Max: 200})
		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("quiet_hours")
		if err != nil {
			return nil
		}
		collection.Fields.RemoveByName("reason")
		return app.Save(collection)
	})
}
