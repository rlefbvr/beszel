package sensors

import (
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/henrygd/beszel/internal/alerts"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// alertCondition is the state of an alert condition on a sensor.
type alertCondition struct {
	active bool
	// subject is what the alert is about beside the sensor, such as its ports
	subject string
	// messages of the triggered and resolved notifications
	title, body, resolvedTitle, resolvedBody alerts.Msg
}

// evaluateAlerts sends the alerts whose condition lasted long enough, and the
// resolved notifications of the triggered alerts whose condition ended.
func (m *Manager) evaluateAlerts(now time.Time) {
	records, err := m.app.FindAllRecords("sensor_alerts")
	if err != nil {
		return
	}
	for _, record := range records {
		m.mu.Lock()
		s := m.sensors[record.GetString("sensor")]
		var condition alertCondition
		if s != nil && !s.paused {
			condition = s.alertCondition(record.GetString("name"), record.GetFloat("value"), record.GetStringSlice("checks"), now)
		}
		since, pending := m.alertSince[record.Id]
		if condition.active && !pending {
			since = now
			m.alertSince[record.Id] = since
		} else if !condition.active {
			delete(m.alertSince, record.Id)
		}
		var sensorID, sensorName string
		if s != nil {
			sensorID, sensorName = s.id, s.name
		}
		m.mu.Unlock()

		triggered := record.GetBool("triggered")
		delay := time.Duration(record.GetInt("min")) * time.Minute
		switch {
		case condition.active && !triggered && now.Sub(since) >= delay:
			m.sendAlert(record, sensorID, sensorName, condition.title, condition.body, alerts.AlertStatusTriggered)
			m.setTriggered(record, true, sensorName, condition.subject)
		case !condition.active && triggered && s != nil:
			m.sendAlert(record, sensorID, sensorName, condition.resolvedTitle, condition.resolvedBody, alerts.AlertStatusResolved)
			m.setTriggered(record, false, sensorName, condition.subject)
		}
	}
}

// historyNames are the names of the sensor alerts in the alerts history.
var historyNames = map[string]string{
	"down":    "SensorDown",
	"loss":    "SensorLoss",
	"latency": "SensorLatency",
	"cert":    "SensorCert",
	"quality": "SensorQuality",
	"port":    "SensorPort",
}

// setTriggered saves the state of an alert, and opens or closes its record in
// the alerts history, like the alerts of the systems.
func (m *Manager) setTriggered(record *core.Record, triggered bool, sensorName, subject string) {
	record.Set("triggered", triggered)
	if err := m.app.Save(record); err != nil {
		m.app.Logger().Error("Failed to save sensor alert", "err", err)
	}
	if triggered {
		collection, err := m.app.FindCachedCollectionByNameOrId("alerts_history")
		if err != nil {
			return
		}
		history := core.NewRecord(collection)
		history.Set("alert_id", record.Id)
		history.Set("user", record.GetString("user"))
		history.Set("sensor", record.GetString("sensor"))
		history.Set("name", historyNames[record.GetString("name")])
		history.Set("value", record.GetFloat("value"))
		monitorName := sensorName
		if subject != "" {
			monitorName += " (" + subject + ")"
		}
		history.Set("monitor_name", monitorName)
		if err := m.app.Save(history); err != nil {
			m.app.Logger().Error("Failed to save sensor alert history", "err", err)
		}
		return
	}
	open, err := m.app.FindAllRecords("alerts_history", dbx.HashExp{"alert_id": record.Id, "resolved": ""})
	if err != nil {
		return
	}
	for _, history := range open {
		history.Set("resolved", time.Now().UTC())
		if err := m.app.Save(history); err != nil {
			m.app.Logger().Error("Failed to resolve sensor alert history", "err", err)
		}
	}
}

func (m *Manager) sendAlert(record *core.Record, sensorID, sensorName string, title, body alerts.Msg, status alerts.AlertStatus) {
	if m.notifier == nil || title.Key == "" {
		return
	}
	err := m.notifier.SendAlert(alerts.AlertMessageData{
		UserID:   record.GetString("user"),
		SensorID: sensorID,
		Title:    title,
		Message:  body,
		Status:   status,
		Link:     m.app.MakeLink("sensor", sensorID),
		LinkText: alerts.M("link.view_sensor", alerts.Args{"sensor": sensorName}),
	})
	if err != nil {
		m.app.Logger().Error("Failed to send sensor alert", "err", err)
	}
}

// alertCondition evaluates an alert of the sensor; the caller holds the lock.
func (s *sensor) alertCondition(name string, value float64, checkIDs []string, now time.Time) alertCondition {
	args := alerts.Args{"sensor": s.name, "host": s.host, "threshold": value}
	switch name {
	case "down":
		var down []string
		for _, c := range s.checks {
			if c.status == "down" {
				down = append(down, c.name())
			}
		}
		args["checks"] = strings.Join(down, ", ")
		return alertCondition{
			active:        s.status == "down",
			title:         alerts.M("sensor.down.title", args),
			body:          alerts.M("sensor.down.body", args),
			resolvedTitle: alerts.M("sensor.up.title", args),
			resolvedBody:  alerts.M("sensor.up.body", args),
		}
	case "loss":
		args["loss"] = s.loss
		return alertCondition{
			active:        s.hasRecentSamples && s.loss > value,
			title:         alerts.M("sensor.loss.title", args),
			body:          alerts.M("sensor.loss.body", args),
			resolvedTitle: alerts.M("sensor.loss.resolved.title", args),
			resolvedBody:  alerts.M("sensor.loss.resolved.body", args),
		}
	case "latency":
		args["latency"] = s.res
		return alertCondition{
			active:        s.hasRecentSamples && s.res > value,
			title:         alerts.M("sensor.latency.title", args),
			body:          alerts.M("sensor.latency.body", args),
			resolvedTitle: alerts.M("sensor.latency.resolved.title", args),
			resolvedBody:  alerts.M("sensor.latency.resolved.body", args),
		}
	case "quality":
		// value 1: degraded or bad, 2: bad only
		worst := map[string]int{"good": 0, "degraded": 1, "bad": 2}[s.quality]
		if s.status == "down" {
			worst = 2
		}
		args["loss"], args["latency"] = s.loss, s.res
		return alertCondition{
			active:        s.hasRecentSamples && s.status != "pending" && worst >= int(math.Max(1, value)),
			title:         alerts.M("sensor.quality.title", args),
			body:          alerts.M("sensor.quality.body", args),
			resolvedTitle: alerts.M("sensor.quality.resolved.title", args),
			resolvedBody:  alerts.M("sensor.quality.resolved.body", args),
		}
	case "port":
		chosen := map[string]bool{}
		for _, id := range checkIDs {
			chosen[id] = true
		}
		var names, down []string
		for _, c := range s.checks {
			if !chosen[c.id] {
				continue
			}
			names = append(names, c.name())
			if c.status == "down" {
				down = append(down, c.name())
			}
		}
		args["checks"] = strings.Join(down, ", ")
		resolvedArgs := alerts.Args{"sensor": s.name, "host": s.host, "checks": strings.Join(names, ", ")}
		return alertCondition{
			active:        len(down) > 0,
			subject:       strings.Join(names, ", "),
			title:         alerts.M("sensor.port.title", args),
			body:          alerts.M("sensor.port.body", args),
			resolvedTitle: alerts.M("sensor.port.resolved.title", resolvedArgs),
			resolvedBody:  alerts.M("sensor.port.resolved.body", resolvedArgs),
		}
	case "cert":
		// the certificate expiring first among the HTTPS checks
		var expiry time.Time
		var address string
		for _, c := range s.checks {
			if !c.certExpiry.IsZero() && (expiry.IsZero() || c.certExpiry.Before(expiry)) {
				expiry, address = c.certExpiry, httpAddress(c.check)
			}
		}
		if expiry.IsZero() {
			return alertCondition{}
		}
		days := math.Floor(expiry.Sub(now).Hours() / 24)
		args["url"], args["date"], args["days"] = address, expiry.Format("2006-01-02"), days
		return alertCondition{
			active:        days < value,
			title:         alerts.M("sensor.cert.title", args),
			body:          alerts.M("sensor.cert.body", args),
			resolvedTitle: alerts.M("sensor.cert.resolved.title", args),
			resolvedBody:  alerts.M("sensor.cert.resolved.body", args),
		}
	}
	return alertCondition{}
}

// name of a check in the notifications: its label, or its protocol and port.
func (c *checkState) name() string {
	if c.label != "" {
		return c.label
	}
	name := strings.ToUpper(c.check.Protocol)
	if c.check.Port != 0 {
		name += " " + strconv.Itoa(c.check.Port)
	}
	return name
}
