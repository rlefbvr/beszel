package alerts

import (
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// handleSmartDeviceAlert sends alerts when a SMART device state worsens into WARNING/FAILED.
// This is automatic and does not require user opt-in.
func (am *AlertManager) handleSmartDeviceAlert(e *core.RecordEvent) error {
	oldState := e.Record.Original().GetString("state")
	newState := e.Record.GetString("state")

	if !shouldSendSmartDeviceAlert(oldState, newState) {
		return e.Next()
	}

	systemID := e.Record.GetString("system")
	if systemID == "" {
		return e.Next()
	}

	// Fetch the system record to get the name and users
	systemRecord, err := e.App.FindRecordById("systems", systemID)
	if err != nil {
		e.App.Logger().Error("Failed to find system for SMART alert", "err", err, "systemID", systemID)
		return e.Next()
	}

	systemName := systemRecord.GetString("name")
	deviceName := e.Record.GetString("name")
	model := e.Record.GetString("model")
	// Build alert message
	args := Args{"system": systemName, "device": deviceName, "model": model, "state": newState}
	title := M("smart.title."+smartStateLabel(newState), args)
	message := M("smart.body", args)
	if model != "" {
		message = M("smart.body_model", args)
	}
	status := AlertStatusTriggered
	if newState == "WARNING" {
		status = AlertStatusWarning
	}

	// Get users associated with the system
	userIDs := systemRecord.GetStringSlice("users")
	if len(userIDs) == 0 {
		return e.Next()
	}

	// Send alert to each user
	for _, userID := range userIDs {
		if err := am.SendAlert(AlertMessageData{
			UserID:      userID,
			SystemID:    systemID,
			SystemName:  systemName,
			Title:       title,
			Message:     message,
			Target:      RawMsg(deviceName),
			TargetLabel: M("target.disk", nil),
			Status:      status,
			Emoji:       smartStateEmoji(newState),
			Link:        am.hub.MakeLink("system", systemID),
			LinkText:    viewSystemLink(systemName),
		}); err != nil {
			e.App.Logger().Error("Failed to send SMART alert", "err", err, "userID", userID)
		}
	}

	return e.Next()
}

func shouldSendSmartDeviceAlert(oldState, newState string) bool {
	oldSeverity := smartStateSeverity(oldState)
	newSeverity := smartStateSeverity(newState)

	// Ignore unknown states and recoveries; only alert on worsening transitions
	// from known-good/degraded states into WARNING/FAILED.
	return oldSeverity >= 1 && newSeverity > oldSeverity
}

func smartStateSeverity(state string) int {
	switch state {
	case "PASSED":
		return 1
	case "WARNING":
		return 2
	case "FAILED":
		return 3
	default:
		return 0
	}
}

func smartStateEmoji(state string) string {
	switch state {
	case "WARNING":
		return "\U0001F7E0"
	default:
		return "\U0001F534"
	}
}

func smartStateLabel(state string) string {
	switch state {
	case "FAILED":
		return "failure"
	default:
		return strings.ToLower(state)
	}
}
