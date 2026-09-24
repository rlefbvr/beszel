package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds the folder the Windows install command installs the agent to.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId(hubSettingsCollection)
		if err != nil {
			return err
		}
		collection.Fields.Add(&core.TextField{
			Name: "agent_install_dir",
			Max:  200,
			// absolute Windows path, safe inside a double-quoted PowerShell argument
			Pattern: `^[A-Za-z]:\\[A-Za-z0-9 _.()\\-]*$`,
		})
		if err := app.Save(collection); err != nil {
			return err
		}
		record, err := app.FindRecordById(hubSettingsCollection, hubSettingsRecordID)
		if err != nil {
			return err
		}
		record.Set("agent_install_dir", `C:\MONITORING`)
		return app.Save(record)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId(hubSettingsCollection)
		if err != nil {
			return nil
		}
		collection.Fields.RemoveByName("agent_install_dir")
		return app.Save(collection)
	})
}
