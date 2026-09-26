package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds a label to the network monitors of the agents, such as the name of the
// service checked on a port.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("network_monitors")
		if err != nil {
			return err
		}
		if collection.Fields.GetByName("label") != nil {
			return nil
		}
		collection.Fields.Add(&core.TextField{Name: "label", Max: 60})
		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("network_monitors")
		if err != nil {
			return err
		}
		collection.Fields.RemoveByName("label")
		return app.Save(collection)
	})
}
