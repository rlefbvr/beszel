package alerts

import (
	"math"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// alertNameCertificate is the name of the certificate expiry alerts, in
// alerts_history and for the quiet hours.
const alertNameCertificate = "Certificate"

// certificateExpiry returns the expiry checked by an alert among the
// certificates of its name: the soonest of the ones in use by a service, or
// else the latest (an old certificate left in a store once renewed).
func certificateExpiry(certs []*core.Record, name string) (time.Time, bool) {
	var used, unused time.Time
	for _, cert := range certs {
		if !strings.EqualFold(cert.GetString("name"), name) {
			continue
		}
		expiry := cert.GetDateTime("not_after").Time()
		if expiry.IsZero() {
			continue
		}
		var uses []map[string]any
		_ = cert.UnmarshalJSONField("uses", &uses)
		if len(uses) > 0 {
			if used.IsZero() || expiry.Before(used) {
				used = expiry
			}
		} else if expiry.After(unused) {
			unused = expiry
		}
	}
	if !used.IsZero() {
		return used, true
	}
	return unused, !unused.IsZero()
}

// HandleCertificateAlerts checks the expiry alerts of the certificates of a
// system: an alert triggers when its certificate expires in fewer days than
// its threshold, and resolves once the certificate is renewed.
func (am *AlertManager) HandleCertificateAlerts(systemID string) error {
	return am.handleCertificateAlerts(systemID, time.Now())
}

func (am *AlertManager) handleCertificateAlerts(systemID string, now time.Time) error {
	app := am.hub
	rules, err := app.FindAllRecords("certificate_alerts", dbx.HashExp{"system": systemID})
	if err != nil || len(rules) == 0 {
		return err
	}
	systemRecord, err := app.FindRecordById("systems", systemID)
	if err != nil {
		return err
	}
	systemName := systemRecord.GetString("name")
	certs, err := app.FindAllRecords("certificates", dbx.HashExp{"system": systemID})
	if err != nil {
		return err
	}

	var messages []AlertMessageData
	err = app.RunInTransaction(func(tx core.App) error {
		for _, rule := range rules {
			name := rule.GetString("name")
			expiry, ok := certificateExpiry(certs, name)
			if !ok {
				// the certificate is gone: its alert stays as it is
				continue
			}
			days := math.Floor(expiry.Sub(now).Hours() / 24)
			active := days < rule.GetFloat("days")
			triggered := rule.GetBool("triggered")
			if active == triggered {
				continue
			}
			args := Args{"name": name, "system": systemName, "date": expiry.Format("2006-01-02"), "days": days}
			message := AlertMessageData{
				UserID:      rule.GetString("user"),
				SystemID:    systemID,
				SystemName:  systemName,
				Kind:        alertNameCertificate,
				Target:      RawMsg(name),
				TargetLabel: M("target.certificate", nil),
				Link:        am.hub.MakeLink("certificates"),
				LinkText:    M("link.view_certificates", nil),
			}
			if active {
				collection, err := tx.FindCachedCollectionByNameOrId("alerts_history")
				if err != nil {
					return err
				}
				history := core.NewRecord(collection)
				history.Load(map[string]any{
					"alert_id": rule.Id, "user": rule.GetString("user"), "system": systemID,
					"name": alertNameCertificate, "monitor_name": name, "value": days,
				})
				if err := tx.Save(history); err != nil {
					return err
				}
				rule.Set("history", history.Id)
				message.Title = M("cert.title", args)
				message.Message = M("cert.body", args)
				if days < 0 {
					message.Message = M("cert.expired.body", args)
				}
				message.Status, message.Emoji = AlertStatusTriggered, "\U0001F534"
			} else {
				if history := rule.GetString("history"); history != "" {
					if err := resolveMonitorIncident(tx, history, now); err != nil {
						return err
					}
				}
				rule.Set("history", "")
				message.Title = M("cert.resolved.title", args)
				message.Message = M("cert.resolved.body", args)
				message.Status, message.Emoji = AlertStatusResolved, "✅"
			}
			rule.Set("triggered", active)
			if err := tx.Save(rule); err != nil {
				return err
			}
			messages = append(messages, message)
		}
		return nil
	})
	if err != nil {
		return err
	}
	for _, message := range messages {
		if err := am.SendAlert(message); err != nil {
			app.Logger().Error("Failed to send certificate alert", "err", err)
		}
	}
	return nil
}

// HandleAllCertificateAlerts checks the expiry alerts of all the systems, as
// the days left go down between the readings of the certificates.
func (am *AlertManager) HandleAllCertificateAlerts() {
	rules, err := am.hub.FindAllRecords("certificate_alerts")
	if err != nil {
		return
	}
	done := map[string]bool{}
	for _, rule := range rules {
		systemID := rule.GetString("system")
		if done[systemID] {
			continue
		}
		done[systemID] = true
		if err := am.HandleCertificateAlerts(systemID); err != nil {
			am.hub.Logger().Error("Failed to check certificate alerts", "system", systemID, "err", err)
		}
	}
}
