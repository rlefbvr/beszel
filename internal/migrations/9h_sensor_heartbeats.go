package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Keeps the probes of the last hour of each sensor, grouped by round, so the
// heartbeat bar of its page survives a restart of the hub. Only the hub reads
// and writes them: the page gets them from /api/beszel/sensors/{id}/heartbeat.
func init() {
	m.Register(func(app core.App) error {
		if _, err := app.FindCollectionByNameOrId("sensor_heartbeats"); err == nil {
			return nil
		}
		sensors, err := app.FindCollectionByNameOrId("sensors")
		if err != nil {
			return err
		}
		collection := core.NewBaseCollection("sensor_heartbeats")
		collection.Fields.Add(
			&core.RelationField{Name: "sensor", CollectionId: sensors.Id, Required: true, MaxSelect: 1, CascadeDelete: true},
			&core.JSONField{Name: "rounds", MaxSize: 500000},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		collection.AddIndex("idx_sensor_heartbeats_sensor", true, "sensor", "")
		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("sensor_heartbeats")
		if err != nil {
			return nil
		}
		return app.Delete(collection)
	})
}
