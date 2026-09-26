package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// LDAPConfigID is the id of the single record of the LDAP settings.
const LDAPConfigID = "ldapconfig00000"

// Adds the login with an LDAP directory (Active Directory):
//   - ldap_config: the directory settings, one record without API rules (read
//     and saved by the hub endpoints for the admins, the bind password never
//     leaves the hub)
//   - users.ldap: the user was created by a directory login; its role follows
//     the directory groups at each login
func init() {
	m.Register(func(app core.App) error {
		collection := core.NewBaseCollection("ldap_config")
		collection.Fields.Add(
			&core.BoolField{Name: "enabled"},
			// ldap://host:389 or ldaps://host:636
			&core.TextField{Name: "url", Max: 500},
			&core.BoolField{Name: "start_tls"},
			&core.BoolField{Name: "skip_verify"},
			// service account searching the users
			&core.TextField{Name: "bind_dn", Max: 500},
			&core.TextField{Name: "bind_password", Max: 500},
			&core.TextField{Name: "base_dn", Max: 500},
			// {username} is replaced by the escaped login name
			&core.TextField{Name: "user_filter", Max: 1000},
			&core.TextField{Name: "email_attribute", Max: 100},
			// group DNs: members of the admin group are admins, of the readonly group
			// read-only; with a users group, the other users can't log in
			&core.TextField{Name: "admin_group", Max: 500},
			&core.TextField{Name: "users_group", Max: 500},
			&core.TextField{Name: "readonly_group", Max: 500},
			// create the users unknown to the hub at their first login
			&core.BoolField{Name: "create_users"},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		if err := app.Save(collection); err != nil {
			return err
		}
		record := core.NewRecord(collection)
		record.Id = LDAPConfigID
		record.Set("user_filter", "(&(objectClass=user)(|(sAMAccountName={username})(userPrincipalName={username})(mail={username})))")
		record.Set("email_attribute", "mail")
		record.Set("create_users", true)
		if err := app.Save(record); err != nil {
			return err
		}

		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		if users.Fields.GetByName("ldap") == nil {
			users.Fields.Add(&core.BoolField{Name: "ldap"})
		}
		return app.Save(users)
	}, func(app core.App) error {
		if users, err := app.FindCollectionByNameOrId("users"); err == nil {
			users.Fields.RemoveByName("ldap")
			if err := app.Save(users); err != nil {
				return err
			}
		}
		if collection, err := app.FindCollectionByNameOrId("ldap_config"); err == nil {
			return app.Delete(collection)
		}
		return nil
	})
}
