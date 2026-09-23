package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

const stateAlertsCollection = "state_alerts"

// Adds the state_alerts collection: per-system rules that alert when services or
// Docker containers enter (or leave) given states.
func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		systems, err := app.FindCollectionByNameOrId("systems")
		if err != nil {
			return err
		}

		ownerRule := `@request.auth.id != "" && user = @request.auth.id`
		writeRule := ownerRule + ` && @request.auth.role != "readonly"`

		collection := core.NewBaseCollection(stateAlertsCollection)
		collection.ListRule = types.Pointer(ownerRule)
		collection.ViewRule = types.Pointer(ownerRule)
		collection.CreateRule = types.Pointer(writeRule)
		collection.UpdateRule = types.Pointer(writeRule)
		collection.DeleteRule = types.Pointer(writeRule)
		collection.Fields.Add(
			&core.RelationField{Name: "user", CollectionId: users.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.RelationField{Name: "system", CollectionId: systems.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.SelectField{Name: "kind", Values: []string{"service", "container"}, MaxSelect: 1, Required: true},
			// comma separated name patterns (* and ? wildcards)
			&core.TextField{Name: "targets", Required: true, Max: 500},
			&core.SelectField{Name: "condition", Values: []string{"is", "is_not"}, MaxSelect: 1, Required: true},
			&core.JSONField{Name: "states", MaxSize: 2000},
			// service sub-states or container health states
			&core.JSONField{Name: "sub_states", MaxSize: 2000},
			// consecutive observations before the alert fires
			&core.NumberField{Name: "cycles", OnlyInt: true, Min: types.Pointer(1.0), Max: types.Pointer(10.0), Required: true},
			&core.BoolField{Name: "triggered"},
			// per-target incident tracking, managed by the hub
			&core.JSONField{Name: "state", MaxSize: 1 << 20},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		collection.AddIndex("idx_state_alerts_system", false, "`system`", "")
		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId(stateAlertsCollection)
		if err != nil {
			return nil
		}
		return app.Delete(collection)
	})
}
