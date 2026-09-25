package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Adds the system_reboots collection: the boots of each system with the end of
// the run before them. Access rules are set with the other system collections.
func init() {
	m.Register(func(app core.App) error {
		systems, err := app.FindCollectionByNameOrId("systems")
		if err != nil {
			return err
		}
		collection := core.NewBaseCollection("system_reboots")
		collection.Fields.Add(
			&core.RelationField{Name: "system", CollectionId: systems.Id, Required: true, MaxSelect: 1, CascadeDelete: true},
			&core.DateField{Name: "boot", Required: true},
			// end of the previous run, empty when unknown
			&core.DateField{Name: "shutdown"},
			// the previous run ended without a clean shutdown
			&core.BoolField{Name: "unexpected"},
			// shutdown reason and requester, when the OS records them
			&core.TextField{Name: "reason", Max: 1000},
			&core.TextField{Name: "user", Max: 200},
			&core.SelectField{Name: "source", MaxSelect: 1, Values: []string{"uptime", "eventlog", "journal", "wtmp"}},
			// notification outcome of the outage for each user: "sent" or "quiet"
			&core.JSONField{Name: "alerts"},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		collection.AddIndex("idx_system_reboots_system_boot", false, "system, boot", "")
		authenticated := `@request.auth.id != ""`
		collection.ListRule = types.Pointer(authenticated)
		collection.ViewRule = types.Pointer(authenticated)
		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("system_reboots")
		if err != nil {
			return nil
		}
		return app.Delete(collection)
	})
}
