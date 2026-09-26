// Package alerts handles alert management and delivery.
package alerts

import (
	"bytes"
	"fmt"
	"io"
	"net/mail"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/nicholas-fedor/shoutrrr"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/mailer"
)

type hubLike interface {
	core.App
	MakeLink(parts ...string) string
}

type AlertManager struct {
	hub             hubLike
	stopOnce        sync.Once
	pendingAlerts   sync.Map
	alertsCache     *AlertsCache
	networkMonitors *networkMonitorCache
}

type UserNotificationSettings struct {
	Emails   []string `json:"emails"`
	Webhooks []string `json:"webhooks"`
	// Lang is the interface language, used to translate notifications.
	Lang string `json:"lang,omitempty"`
	// HeaderLabel is the label shown next to the logo in the interface
	// ("name", "url" or "none"), also used in the header of the emails.
	HeaderLabel string `json:"headerLabel,omitempty"`
}

type SystemAlertFsStats struct {
	DiskTotal float64 `json:"d"`
	DiskUsed  float64 `json:"du"`
}

// Values pulled from system_stats.stats that are relevant to alerts.
type SystemAlertStats struct {
	Cpu          float64                       `json:"cpu"`
	CpuBreakdown []float64                     `json:"cpub"`
	Mem          float64                       `json:"mp"`
	Disk         float64                       `json:"dp"`
	Bandwidth    [2]uint64                     `json:"b"`
	GPU          map[string]SystemAlertGPUData `json:"g"`
	Temperatures map[string]float32            `json:"t"`
	LoadAvg      [3]float64                    `json:"la"`
	Battery      [2]uint8                      `json:"bat"`
	Batteries    map[string]uint8              `json:"bats"`
	ExtraFs      map[string]SystemAlertFsStats `json:"efs"`
	ZfsPools     map[string]SystemAlertZfsPool `json:"z"`
}

type SystemAlertGPUData struct {
	Usage float64 `json:"u"`
}

type SystemAlertZfsPool struct {
	Raw   bool    `json:"raw,omitempty"`
	Total float64 `json:"d"`
	Used  float64 `json:"du"`
}

type SystemAlertData struct {
	systemRecord *core.Record
	alertData    CachedAlertData
	name         string
	unit         string
	val          float64
	threshold    float64
	triggered    bool
	time         time.Time
	count        uint8
	min          uint8
	mapSums      map[string]float32
	descriptor   Msg // override descriptor in notification body (for temp sensor, disk partition, etc)
}

// notification services that support title param
var supportsTitle = map[string]struct{}{
	"bark":       {},
	"discord":    {},
	"gotify":     {},
	"ifttt":      {},
	"join":       {},
	"lark":       {},
	"ntfy":       {},
	"opsgenie":   {},
	"pushbullet": {},
	"pushover":   {},
	"slack":      {},
	"teams":      {},
	"telegram":   {},
	"zulip":      {},
}

// NewAlertManager creates a new AlertManager instance.
func NewAlertManager(app hubLike) *AlertManager {
	am := &AlertManager{
		hub:             app,
		alertsCache:     NewAlertsCache(app),
		networkMonitors: newNetworkMonitorCache(app),
	}
	am.bindEvents()
	return am
}

// Bind events to the alerts collection lifecycle
func (am *AlertManager) bindEvents() {
	am.bindNetworkMonitorAlertEvents()
	am.bindStateAlertEvents()
	am.hub.OnRecordAfterUpdateSuccess("alerts").BindFunc(updateHistoryOnAlertUpdate)
	am.hub.OnRecordAfterDeleteSuccess("alerts").BindFunc(resolveHistoryOnAlertDelete)
	am.hub.OnRecordAfterUpdateSuccess("smart_devices").BindFunc(am.handleSmartDeviceAlert)
	am.hub.OnRecordAfterCreateSuccess("zfs_pools").BindFunc(am.handleZfsPoolCreateAlert)
	am.hub.OnRecordAfterUpdateSuccess("zfs_pools").BindFunc(am.handleZfsPoolAlert)
	am.hub.OnRecordAfterDeleteSuccess("zfs_pools").BindFunc(resolveZfsPoolHistoryOnDelete)

	am.hub.OnServe().BindFunc(func(e *core.ServeEvent) error {
		// Populate all alerts into cache on startup
		_ = am.alertsCache.PopulateFromDB(true)

		if err := resolveStatusAlerts(e.App); err != nil {
			e.App.Logger().Error("Failed to resolve stale status alerts", "err", err)
		}
		if err := resolveSystemdAlerts(e.App); err != nil {
			e.App.Logger().Error("Failed to resolve stale systemd alerts", "err", err)
		}
		if err := am.restorePendingStatusAlerts(); err != nil {
			e.App.Logger().Error("Failed to restore pending status alerts", "err", err)
		}
		return e.Next()
	})
}

// IsNotificationSilenced checks if a notification should be silenced based on configured quiet hours
func (am *AlertManager) IsNotificationSilenced(userID, systemID string) bool {
	return am.isSilencedAt(userID, systemID, time.Now().UTC())
}

// IsTargetSilenced checks if quiet hours silence the state alerts of a service or container of a system.
func (am *AlertManager) IsTargetSilenced(userID, systemID, kind, targetName string) bool {
	return am.isSilencedFor(userID, systemID, "", kind, "", targetName, time.Now().UTC())
}

// IsAlertSilenced checks if quiet hours silence an alert type or a state rule of a system.
func (am *AlertManager) IsAlertSilenced(userID, systemID, kind, ruleID string) bool {
	return am.isSilencedFor(userID, systemID, "", kind, ruleID, "", time.Now().UTC())
}

// IsSensorNotificationSilenced checks if quiet hours silence the notifications of a network sensor
func (am *AlertManager) IsSensorNotificationSilenced(userID, sensorID string) bool {
	return am.isSilencedFor(userID, "", sensorID, "", "", "", time.Now().UTC())
}

// isSilencedAt checks if quiet hours silence the status notifications of a system at a given time
func (am *AlertManager) isSilencedAt(userID, systemID string, now time.Time) bool {
	return am.isSilencedFor(userID, systemID, "", "Status", "", "", now)
}

// quietWindowApplies tells whether a quiet hours window silences an alert: a
// window without alert types or rules silences all of them, else the alert
// must be of one of its types or come from one of its rules.
func quietWindowApplies(window *core.Record, kind, ruleID, targetName string) bool {
	var kinds []string
	_ = window.UnmarshalJSONField("alerts", &kinds)
	rules := window.GetStringSlice("rules")
	var targets []quietTarget
	_ = window.UnmarshalJSONField("targets", &targets)
	if len(kinds) == 0 && len(rules) == 0 && len(targets) == 0 {
		return true
	}
	if (kind != "" && slices.Contains(kinds, kind)) || (ruleID != "" && slices.Contains(rules, ruleID)) {
		return true
	}
	return targetName != "" && slices.ContainsFunc(targets, func(target quietTarget) bool {
		return target.matches(kind, targetName)
	})
}

// quietTarget is a service, container or process silenced by a quiet hours window.
type quietTarget struct {
	Kind string `json:"kind"`
	Name string `json:"name"`
}

// matches tells whether the target is the one of an alert: a service for the
// service state alerts, a container for the container state alerts.
func (t quietTarget) matches(kind, name string) bool {
	switch kind {
	case alertNameServiceState:
		return t.Kind == stateAlertKindService && strings.EqualFold(t.Name, name)
	case alertNameContainerState:
		return t.Kind == stateAlertKindContainer && strings.EqualFold(t.Name, name)
	case alertNameProcessState:
		return t.Kind == stateAlertKindProcess && strings.EqualFold(t.Name, name)
	}
	return false
}

// isSilencedFor checks if quiet hours silence the notifications of a system or
// of a network sensor at a given time: global windows (neither system nor
// sensor), and the windows of the system or of the sensor, limited to the
// alert types and rules they name.
func (am *AlertManager) isSilencedFor(userID, systemID, sensorID, kind, ruleID, targetName string, now time.Time) bool {
	filter := "user={:user} AND ((system='' AND COALESCE(sensor, '')='')"
	params := dbx.Params{"user": userID}
	if systemID != "" {
		filter += " OR system={:system}"
		params["system"] = systemID
	}
	if sensorID != "" {
		filter += " OR sensor={:sensor}"
		params["sensor"] = sensorID
	}
	filter += ")"

	quietHourWindows, err := am.hub.FindAllRecords("quiet_hours", dbx.NewExp(filter, params))
	if err != nil || len(quietHourWindows) == 0 {
		return false
	}

	now = now.UTC()

	for _, window := range quietHourWindows {
		if !quietWindowApplies(window, kind, ruleID, targetName) {
			continue
		}
		if quietWindowActive(window, now) {
			return true
		}
	}

	return false
}

// SendAlert sends an alert to the user
func (am *AlertManager) SendAlert(data AlertMessageData) error {
	// Check if alert is silenced
	if am.isSilencedFor(data.UserID, data.SystemID, data.SensorID, data.Kind, data.RuleID, data.TargetName, time.Now().UTC()) {
		am.hub.Logger().Info("Notification silenced", "user", data.UserID, "system", data.SystemID, "title", data.Title)
		return nil
	}

	// get user settings
	record, err := am.hub.FindFirstRecordByFilter(
		"user_settings", "user={:user}",
		dbx.Params{"user": data.UserID},
	)
	if err != nil {
		return err
	}
	// unmarshal user settings
	userAlertSettings := UserNotificationSettings{
		Emails:   []string{},
		Webhooks: []string{},
	}
	if err := record.UnmarshalJSONField("settings", &userAlertSettings); err != nil {
		am.hub.Logger().Error("Failed to unmarshal user settings", "err", err)
	}
	// send alerts via webhooks
	send := sendPublicNotification
	if len(userAlertSettings.Webhooks) > 0 {
		// Read the owner's current role at delivery time, including for URLs
		// saved before an admin was demoted. Never fall back on lookup failure.
		owner, err := am.hub.FindRecordById("users", data.UserID)
		if err != nil {
			return fmt.Errorf("load notification owner: %w", err)
		}
		if owner.GetString("role") == "admin" {
			send = shoutrrr.Send
		}
	}
	appURL := am.hub.Settings().Meta.AppURL
	settingsLink := ""
	if appURL != "" {
		settingsLink = am.hub.MakeLink("settings", "notifications")
	}
	rendered := data.render(NewTranslator(userAlertSettings.Lang), appURL, settingsLink)
	rendered.Brand = emailBrand(userAlertSettings.HeaderLabel, am.hub.Settings().Meta.AppName, appURL)
	for _, webhook := range userAlertSettings.Webhooks {
		if err := am.sendShoutrrrAlert(webhook, rendered.WebhookTitle, rendered.webhookText(webhookScheme(webhook)), rendered.Link, rendered.LinkText, send); err != nil {
			am.hub.Logger().Error("Failed to send shoutrrr alert", "err", err)
		}
	}
	// send alerts via email
	if len(userAlertSettings.Emails) == 0 {
		return nil
	}
	addresses := []mail.Address{}
	for _, email := range userAlertSettings.Emails {
		addresses = append(addresses, mail.Address{Address: email})
	}
	html, err := rendered.html()
	if err != nil {
		return err
	}
	message := mailer.Message{
		To:      addresses,
		Subject: rendered.Subject,
		HTML:    html,
		Text:    rendered.plainText() + fmt.Sprintf("\n\n%s", rendered.Link),
		From: mail.Address{
			Address: am.hub.Settings().Meta.SenderAddress,
			Name:    am.hub.Settings().Meta.SenderName,
		},
		InlineAttachments: map[string]io.Reader{"beszel-icon.png": bytes.NewReader(emailIcon)},
	}
	err = am.hub.NewMailClient().Send(&message)
	if err != nil {
		return err
	}
	am.hub.Logger().Info("Sent email alert", "to", message.To, "subj", message.Subject)
	return nil
}

// SendShoutrrrAlert sends an alert via a Shoutrrr URL
func (am *AlertManager) SendShoutrrrAlert(notificationUrl, title, message, link, linkText string) error {
	return am.sendShoutrrrAlert(notificationUrl, title, message, link, linkText, shoutrrr.Send)
}

// webhookScheme returns the service scheme of a notification URL, such as "teams".
func webhookScheme(notificationUrl string) string {
	if scheme, _, found := strings.Cut(notificationUrl, "://"); found {
		return strings.ToLower(scheme)
	}
	return ""
}

func (am *AlertManager) sendShoutrrrAlert(notificationUrl, title, message, link, linkText string, send func(string, string) error) error {
	// Parse the URL
	parsedURL, err := url.Parse(notificationUrl)
	if err != nil {
		return fmt.Errorf("error parsing URL: %v", err)
	}
	scheme := parsedURL.Scheme
	queryParams := parsedURL.Query()

	// Add title
	if _, ok := supportsTitle[scheme]; ok {
		queryParams.Add("title", title)
	} else if scheme == "mattermost" {
		// use markdown title for mattermost
		message = "##### " + title + "\n\n" + message
	} else if scheme == "generic" && queryParams.Has("template") {
		// add title as property if using generic with template json
		titleKey := queryParams.Get("titlekey")
		if titleKey == "" {
			titleKey = "title"
		}
		queryParams.Add("$"+titleKey, title)
	} else {
		// otherwise just add title to message
		message = title + "\n\n" + message
	}

	// Add link
	switch scheme {
	case "ntfy":
		queryParams.Add("Actions", fmt.Sprintf("view, %s, %s", linkText, link))
	case "lark":
		queryParams.Add("link", link)
	case "bark":
		queryParams.Add("url", link)
	default:
		message += "\n\n" + link
	}

	// Encode the modified query parameters back into the URL
	parsedURL.RawQuery = queryParams.Encode()
	// log.Println("URL after modification:", parsedURL.String())

	err = send(parsedURL.String(), message)

	if err == nil {
		am.hub.Logger().Info("Sent shoutrrr alert", "title", title)
	} else {
		am.hub.Logger().Error("Error sending shoutrrr alert", "err", err)
		return err
	}
	return nil
}

// setAlertTriggered updates the "triggered" status of an alert record in the database
func (am *AlertManager) setAlertTriggered(alert CachedAlertData, triggered bool) error {
	alertRecord, err := am.hub.FindRecordById("alerts", alert.Id)
	if err != nil {
		return err
	}
	alertRecord.Set("triggered", triggered)
	return am.hub.Save(alertRecord)
}
