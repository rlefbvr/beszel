package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds the color chosen for the pill of a check on another port than the
// known ones, such as #22c55e; empty for the default color.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("sensor_checks")
		if err != nil {
			return err
		}
		if collection.Fields.GetByName("color") != nil {
			return nil
		}
		collection.Fields.Add(&core.TextField{Name: "color", Max: 20, Pattern: `^(#[0-9a-fA-F]{6})?$`})
		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("sensor_checks")
		if err != nil {
			return err
		}
		collection.Fields.RemoveByName("color")
		return app.Save(collection)
	})
}
