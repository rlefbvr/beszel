package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Adds the certificates of the hosts:
//   - certificates: the server certificates found by the agents, with where
//     they are configured; kept by the hub
//   - certificate_paths: the certificate files added by the users on a host
//   - certificate_alerts: the expiry alerts of each user on the certificates of
//     a name on a host (the certificates with an alert are the important ones)
//
// The access rules of the first two are set with the other system collections.
func init() {
	m.Register(func(app core.App) error {
		systems, err := app.FindCollectionByNameOrId("systems")
		if err != nil {
			return err
		}
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}

		certificates := core.NewBaseCollection("certificates")
		certificates.Fields.Add(
			&core.RelationField{Name: "system", CollectionId: systems.Id, Required: true, MaxSelect: 1, CascadeDelete: true},
			// "file:<path>", "custom:<path>" or "store:<store>\<thumbprint>", unique on the system
			&core.TextField{Name: "key", Required: true, Max: 2000},
			&core.TextField{Name: "path", Max: 2000},
			// first name of the certificate: common name or first alternative name
			&core.TextField{Name: "name", Max: 500},
			&core.JSONField{Name: "names", MaxSize: 20000},
			&core.TextField{Name: "subject", Max: 2000},
			&core.TextField{Name: "issuer", Max: 2000},
			&core.DateField{Name: "not_before"},
			&core.DateField{Name: "not_after"},
			&core.TextField{Name: "fingerprint", Max: 64},
			&core.TextField{Name: "thumbprint", Max: 40},
			&core.TextField{Name: "serial", Max: 100},
			&core.BoolField{Name: "self_signed"},
			&core.BoolField{Name: "custom"},
			&core.TextField{Name: "error", Max: 500},
			// where the certificate is configured: [{kind, location, detail}]
			&core.JSONField{Name: "uses", MaxSize: 50000},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		certificates.AddIndex("idx_certificates_system_key", true, "system, `key`", "")
		authenticated := `@request.auth.id != ""`
		certificates.ListRule = types.Pointer(authenticated)
		certificates.ViewRule = types.Pointer(authenticated)
		if err := app.Save(certificates); err != nil {
			return err
		}

		paths := core.NewBaseCollection("certificate_paths")
		paths.Fields.Add(
			&core.RelationField{Name: "system", CollectionId: systems.Id, Required: true, MaxSelect: 1, CascadeDelete: true},
			&core.TextField{Name: "path", Required: true, Max: 1000},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		paths.AddIndex("idx_certificate_paths_system_path", true, "system, path", "")
		paths.ListRule = types.Pointer(authenticated)
		paths.ViewRule = types.Pointer(authenticated)
		if err := app.Save(paths); err != nil {
			return err
		}

		ownerRule := `@request.auth.id != "" && user = @request.auth.id`
		writeRule := ownerRule + ` && @request.auth.role != "readonly"`
		alerts := core.NewBaseCollection("certificate_alerts")
		alerts.ListRule = types.Pointer(ownerRule)
		alerts.ViewRule = types.Pointer(ownerRule)
		alerts.CreateRule = types.Pointer(writeRule)
		alerts.UpdateRule = types.Pointer(writeRule)
		alerts.DeleteRule = types.Pointer(writeRule)
		alerts.Fields.Add(
			&core.RelationField{Name: "user", CollectionId: users.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.RelationField{Name: "system", CollectionId: systems.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			// name of the certificates checked: renewed certificates keep their name
			&core.TextField{Name: "name", Required: true, Max: 500},
			// days before expiry when the alert triggers
			&core.NumberField{Name: "days", OnlyInt: true, Min: types.Pointer(1.0), Max: types.Pointer(365.0), Required: true},
			&core.BoolField{Name: "triggered"},
			// open alerts_history record while triggered, managed by the hub
			&core.TextField{Name: "history", Max: 50},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		alerts.AddIndex("idx_certificate_alerts_user_system_name", true, "user, system, name", "")
		return app.Save(alerts)
	}, func(app core.App) error {
		for _, name := range []string{"certificate_alerts", "certificate_paths", "certificates"} {
			if collection, err := app.FindCollectionByNameOrId(name); err == nil {
				if err := app.Delete(collection); err != nil {
					return err
				}
			}
		}
		return nil
	})
}
