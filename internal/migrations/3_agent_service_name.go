package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds the name of the agent service used by the install commands.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId(hubSettingsCollection)
		if err != nil {
			return err
		}
		collection.Fields.Add(&core.TextField{
			Name:     "agent_service_name",
			Required: true,
			Max:      64,
			// safe in file names and shell commands
			Pattern: `^[A-Za-z0-9][A-Za-z0-9_.@-]*$`,
		})
		if err := app.Save(collection); err != nil {
			return err
		}
		record, err := app.FindRecordById(hubSettingsCollection, hubSettingsRecordID)
		if err != nil {
			return err
		}
		record.Set("agent_service_name", "beszel-agent")
		return app.Save(record)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId(hubSettingsCollection)
		if err != nil {
			return nil
		}
		collection.Fields.RemoveByName("agent_service_name")
		return app.Save(collection)
	})
}
