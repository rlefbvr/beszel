package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Adds the audit log: the logins (successful or failed) and the sensitive
// changes, with who, from where and on what. Written by the hub only, read by
// the admins; kept the number of days of hub_settings.audit_retention_days.
func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		collection := core.NewBaseCollection("audit_logs")
		collection.Fields.Add(
			// the user, kept when deleted through the email
			&core.RelationField{Name: "user", CollectionId: users.Id, MaxSelect: 1},
			&core.TextField{Name: "email", Max: 500},
			// login, login_failed, create, update, delete, mfa_enabled...
			&core.TextField{Name: "action", Required: true, Max: 50},
			// how: password, otp, totp, ldap, oauth2; or the collection changed
			&core.TextField{Name: "target_type", Max: 100},
			&core.TextField{Name: "target_id", Max: 100},
			&core.TextField{Name: "target_name", Max: 500},
			&core.TextField{Name: "ip", Max: 100},
			&core.TextField{Name: "user_agent", Max: 500},
			&core.JSONField{Name: "details", MaxSize: 20000},
			&core.AutodateField{Name: "created", OnCreate: true},
		)
		collection.AddIndex("idx_audit_logs_created", false, "created", "")
		adminRule := `@request.auth.id != "" && @request.auth.role = "admin"`
		collection.ListRule = types.Pointer(adminRule)
		collection.ViewRule = types.Pointer(adminRule)
		if err := app.Save(collection); err != nil {
			return err
		}

		settings, err := app.FindCollectionByNameOrId(hubSettingsCollection)
		if err != nil {
			return err
		}
		settings.Fields.Add(&core.NumberField{
			Name:    "audit_retention_days",
			OnlyInt: true,
			Min:     types.Pointer(1.0),
			Max:     types.Pointer(3650.0),
		})
		if err := app.Save(settings); err != nil {
			return err
		}
		record, err := app.FindRecordById(hubSettingsCollection, hubSettingsRecordID)
		if err != nil {
			return err
		}
		record.Set("audit_retention_days", 90)
		return app.Save(record)
	}, func(app core.App) error {
		if settings, err := app.FindCollectionByNameOrId(hubSettingsCollection); err == nil {
			settings.Fields.RemoveByName("audit_retention_days")
			if err := app.Save(settings); err != nil {
				return err
			}
		}
		if collection, err := app.FindCollectionByNameOrId("audit_logs"); err == nil {
			return app.Delete(collection)
		}
		return nil
	})
}
