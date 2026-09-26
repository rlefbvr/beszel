package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds the alerts on the packet quality of a sensor and on chosen ports that
// no longer respond, and keeps the history of the sensor alerts with the other
// alerts:
//   - sensor_alerts.name gets "quality" (value 1: degraded or bad, 2: bad) and
//     "port" (the checks chosen in sensor_alerts.checks are down)
//   - alerts_history gets a sensor relation, and its system becomes optional
func init() {
	m.Register(func(app core.App) error {
		alerts, err := app.FindCollectionByNameOrId("sensor_alerts")
		if err != nil {
			return err
		}
		if name, ok := alerts.Fields.GetByName("name").(*core.SelectField); ok {
			name.Values = []string{"down", "loss", "latency", "cert", "quality", "port"}
		}
		checks, err := app.FindCollectionByNameOrId("sensor_checks")
		if err != nil {
			return err
		}
		if alerts.Fields.GetByName("checks") == nil {
			alerts.Fields.Add(&core.RelationField{Name: "checks", CollectionId: checks.Id, MaxSelect: 999})
		}
		if err := app.Save(alerts); err != nil {
			return err
		}

		history, err := app.FindCollectionByNameOrId("alerts_history")
		if err != nil {
			return err
		}
		if system, ok := history.Fields.GetByName("system").(*core.RelationField); ok {
			system.Required = false
		}
		sensors, err := app.FindCollectionByNameOrId("sensors")
		if err != nil {
			return err
		}
		if history.Fields.GetByName("sensor") == nil {
			history.Fields.Add(&core.RelationField{Name: "sensor", CollectionId: sensors.Id, MaxSelect: 1, CascadeDelete: true})
		}
		return app.Save(history)
	}, func(app core.App) error {
		if _, err := app.DB().NewQuery("DELETE FROM sensor_alerts WHERE name IN ('quality', 'port')").Execute(); err != nil {
			return err
		}
		if _, err := app.DB().NewQuery("DELETE FROM alerts_history WHERE system = '' OR system IS NULL").Execute(); err != nil {
			return err
		}
		alerts, err := app.FindCollectionByNameOrId("sensor_alerts")
		if err != nil {
			return err
		}
		if name, ok := alerts.Fields.GetByName("name").(*core.SelectField); ok {
			name.Values = []string{"down", "loss", "latency", "cert"}
		}
		alerts.Fields.RemoveByName("checks")
		if err := app.Save(alerts); err != nil {
			return err
		}
		history, err := app.FindCollectionByNameOrId("alerts_history")
		if err != nil {
			return err
		}
		history.Fields.RemoveByName("sensor")
		if system, ok := history.Fields.GetByName("system").(*core.RelationField); ok {
			system.Required = true
		}
		return app.Save(history)
	})
}
