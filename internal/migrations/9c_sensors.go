package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// statsTypes are the aggregation types of the stats records.
var statsTypes = []string{"1m", "10m", "20m", "120m", "480m", "1440m"}

// Adds the network sensors checked by the hub itself, shared by all users:
//   - sensors: a host with its display settings and its overall state
//   - sensor_checks: the checks of a host (ICMP, TCP port, HTTP, DNS, NTP)
//   - sensor_stats: probe counts and response times, aggregated like the system stats
//   - sensor_incidents: the interruptions of the checks
//   - sensor_alerts: the alerts of each user on a sensor
//
// and the quiet hours of a sensor.
func init() {
	m.Register(func(app core.App) error {
		authenticated := `@request.auth.id != ""`
		writer := authenticated + ` && @request.auth.role != "readonly"`

		sensors := core.NewBaseCollection("sensors")
		sensors.Fields.Add(
			&core.TextField{Name: "name", Required: true, Max: 100},
			// IP address or host name of the machine
			&core.TextField{Name: "host", Required: true, Max: 255},
			&core.TextField{Name: "description", Max: 200},
			&core.TextField{Name: "group", Max: 40},
			// seconds between two probes of each check
			&core.NumberField{Name: "interval", OnlyInt: true, Min: types.Pointer(10.0), Max: types.Pointer(3600.0)},
			// failed probes in a row tolerated before a check is down
			&core.NumberField{Name: "retries", OnlyInt: true, Min: types.Pointer(0.0), Max: types.Pointer(10.0)},
			// average response time (ms) above which the quality is degraded, 0 for none
			&core.NumberField{Name: "latency_threshold", OnlyInt: true, Min: types.Pointer(0.0), Max: types.Pointer(60000.0)},
			&core.BoolField{Name: "paused"},
			// state kept by the hub
			&core.SelectField{Name: "status", MaxSelect: 1, Values: []string{"pending", "up", "down", "paused"}},
			&core.SelectField{Name: "quality", MaxSelect: 1, Values: []string{"good", "degraded", "bad"}},
			&core.NumberField{Name: "res"},
			&core.NumberField{Name: "loss"},
			&core.NumberField{Name: "uptime"},
			&core.DateField{Name: "last_check"},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		sensors.ListRule = types.Pointer(authenticated)
		sensors.ViewRule = types.Pointer(authenticated)
		sensors.CreateRule = types.Pointer(writer)
		sensors.UpdateRule = types.Pointer(writer)
		sensors.DeleteRule = types.Pointer(writer)
		if err := app.Save(sensors); err != nil {
			return err
		}

		checks := core.NewBaseCollection("sensor_checks")
		checks.Fields.Add(
			&core.RelationField{Name: "sensor", CollectionId: sensors.Id, Required: true, MaxSelect: 1, CascadeDelete: true},
			&core.SelectField{Name: "protocol", Required: true, MaxSelect: 1, Values: []string{"icmp", "tcp", "http", "dns", "ntp"}},
			&core.NumberField{Name: "port", OnlyInt: true, Min: types.Pointer(0.0), Max: types.Pointer(65535.0)},
			// name of the port or service, such as SSH
			&core.TextField{Name: "label", Max: 40},
			// HTTP: address checked; DNS: name resolved
			&core.TextField{Name: "url", Max: 500},
			// HTTP: text the page must contain
			&core.TextField{Name: "keyword", Max: 200},
			// HTTP: accepted status codes, such as "200-299,401"
			&core.TextField{Name: "accepted_codes", Max: 100},
			&core.BoolField{Name: "ignore_tls"},
			// state kept by the hub
			&core.SelectField{Name: "status", MaxSelect: 1, Values: []string{"pending", "up", "down"}},
			&core.NumberField{Name: "res"},
			&core.NumberField{Name: "code"},
			&core.TextField{Name: "message", Max: 500},
			&core.DateField{Name: "cert_expiry"},
			&core.DateField{Name: "last_check"},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		checks.AddIndex("idx_sensor_checks_sensor", false, "sensor", "")
		checks.ListRule = types.Pointer(authenticated)
		checks.ViewRule = types.Pointer(authenticated)
		checks.CreateRule = types.Pointer(writer)
		checks.UpdateRule = types.Pointer(writer)
		checks.DeleteRule = types.Pointer(writer)
		if err := app.Save(checks); err != nil {
			return err
		}

		stats := core.NewBaseCollection("sensor_stats")
		stats.Fields.Add(
			&core.RelationField{Name: "sensor", CollectionId: sensors.Id, Required: true, MaxSelect: 1, CascadeDelete: true},
			&core.RelationField{Name: "check", CollectionId: checks.Id, Required: true, MaxSelect: 1, CascadeDelete: true},
			&core.SelectField{Name: "type", Required: true, MaxSelect: 1, Values: statsTypes},
			// unix time in milliseconds, like network_monitor_stats
			&core.NumberField{Name: "created", OnlyInt: true},
			&core.NumberField{Name: "total_count", OnlyInt: true},
			&core.NumberField{Name: "success_count", OnlyInt: true},
			// response times of the successful probes, in microseconds
			&core.NumberField{Name: "res_sum", OnlyInt: true},
			&core.NumberField{Name: "res_min"},
			&core.NumberField{Name: "res_max"},
		)
		stats.AddIndex("idx_sensor_stats_check_type_created", false, "`check`, type, created", "")
		stats.AddIndex("idx_sensor_stats_sensor_type_created", false, "sensor, type, created", "")
		stats.ListRule = types.Pointer(authenticated)
		if err := app.Save(stats); err != nil {
			return err
		}

		incidents := core.NewBaseCollection("sensor_incidents")
		incidents.Fields.Add(
			&core.RelationField{Name: "sensor", CollectionId: sensors.Id, Required: true, MaxSelect: 1, CascadeDelete: true},
			&core.RelationField{Name: "check", CollectionId: checks.Id, Required: true, MaxSelect: 1, CascadeDelete: true},
			&core.DateField{Name: "start", Required: true},
			// empty while the interruption lasts
			&core.DateField{Name: "end"},
			// HTTP status code, 0 when there was no response
			&core.NumberField{Name: "code", OnlyInt: true},
			&core.TextField{Name: "message", Max: 500},
		)
		incidents.AddIndex("idx_sensor_incidents_sensor_start", false, "sensor, start", "")
		incidents.ListRule = types.Pointer(authenticated)
		incidents.ViewRule = types.Pointer(authenticated)
		if err := app.Save(incidents); err != nil {
			return err
		}

		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		owner := authenticated + ` && user = @request.auth.id`
		alerts := core.NewBaseCollection("sensor_alerts")
		alerts.Fields.Add(
			&core.RelationField{Name: "user", CollectionId: users.Id, Required: true, MaxSelect: 1, CascadeDelete: true},
			&core.RelationField{Name: "sensor", CollectionId: sensors.Id, Required: true, MaxSelect: 1, CascadeDelete: true},
			// down: a check is down; loss: packet loss (%) above value; latency: average
			// response time (ms) above value; cert: TLS certificate expiring within value days
			&core.SelectField{Name: "name", Required: true, MaxSelect: 1, Values: []string{"down", "loss", "latency", "cert"}},
			&core.NumberField{Name: "value"},
			// minutes the condition must last before the alert is sent
			&core.NumberField{Name: "min", OnlyInt: true, Min: types.Pointer(0.0), Max: types.Pointer(1440.0)},
			&core.BoolField{Name: "triggered"},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		alerts.AddIndex("idx_sensor_alerts_user_sensor_name", true, "user, sensor, name", "")
		alerts.ListRule = types.Pointer(owner)
		alerts.ViewRule = types.Pointer(owner)
		alerts.CreateRule = types.Pointer(owner)
		alerts.UpdateRule = types.Pointer(owner)
		alerts.DeleteRule = types.Pointer(owner)
		if err := app.Save(alerts); err != nil {
			return err
		}

		quietHours, err := app.FindCollectionByNameOrId("quiet_hours")
		if err != nil {
			return err
		}
		quietHours.Fields.Add(&core.RelationField{Name: "sensor", CollectionId: sensors.Id, MaxSelect: 1, CascadeDelete: true})
		return app.Save(quietHours)
	}, func(app core.App) error {
		if quietHours, err := app.FindCollectionByNameOrId("quiet_hours"); err == nil {
			quietHours.Fields.RemoveByName("sensor")
			if err := app.Save(quietHours); err != nil {
				return err
			}
		}
		for _, name := range []string{"sensor_alerts", "sensor_incidents", "sensor_stats", "sensor_checks", "sensors"} {
			if collection, err := app.FindCollectionByNameOrId(name); err == nil {
				if err := app.Delete(collection); err != nil {
					return err
				}
			}
		}
		return nil
	})
}
