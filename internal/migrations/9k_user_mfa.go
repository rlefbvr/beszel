package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds the second factor chosen by each user: an authenticator app (TOTP) or a
// code sent by email. The secrets and recovery codes are hidden from the API
// and only changed by the hub endpoints.
func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		if users.Fields.GetByName("mfa") == nil {
			users.Fields.Add(
				// second factor: "" (none), "totp" or "email"
				&core.SelectField{Name: "mfa", Values: []string{"totp", "email"}, MaxSelect: 1},
				// base32 secret of the authenticator app, and the one being enrolled
				&core.TextField{Name: "totp_secret", Hidden: true, Max: 100},
				&core.TextField{Name: "totp_pending", Hidden: true, Max: 100},
				// last time step accepted, so a code can't be used twice
				&core.NumberField{Name: "totp_last", Hidden: true, OnlyInt: true},
				// SHA-256 of the unused recovery codes
				&core.JSONField{Name: "mfa_recovery", Hidden: true, MaxSize: 4000},
			)
		}
		return app.Save(users)
	}, func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		for _, name := range []string{"mfa", "totp_secret", "totp_pending", "totp_last", "mfa_recovery"} {
			users.Fields.RemoveByName(name)
		}
		users.MFA.Rule = ""
		return app.Save(users)
	})
}
