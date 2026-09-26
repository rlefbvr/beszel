package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds the details of the TLS certificate of the HTTPS checks: subject,
// issuer, names, validity, fingerprint, chain and trust.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("sensor_checks")
		if err != nil {
			return err
		}
		if collection.Fields.GetByName("cert") != nil {
			return nil
		}
		collection.Fields.Add(&core.JSONField{Name: "cert", MaxSize: 50000})
		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("sensor_checks")
		if err != nil {
			return err
		}
		collection.Fields.RemoveByName("cert")
		return app.Save(collection)
	})
}
