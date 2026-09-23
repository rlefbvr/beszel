package alerts

import (
	"errors"
	"strings"
	"time"

	"github.com/henrygd/beszel/internal/entities/container"
	"github.com/henrygd/beszel/internal/entities/system"

	"github.com/pocketbase/pocketbase/core"
)

const (
	// containerAlertName is the value stored in the alerts.name field for this alert type.
	containerAlertName = "ContainerHealth"

	// containerLogMaxLines caps how many matched (error/fatal) log lines are kept.
	containerLogMaxLines = 12
	// containerLogFallbackLines is how many trailing raw log lines are used when no
	// line matches "error" or "fatal", so the notification still carries some context.
	containerLogFallbackLines = 6
	// containerLogExcerptMaxChars bounds a single container's log excerpt so a
	// handful of containers can't blow past Discord's message size limit.
	containerLogExcerptMaxChars = 500
	// containerAlertMaxLogged is the max number of unhealthy containers we fetch
	// and embed logs for in a single alert message.
	containerAlertMaxLogged = 2
)

// FetchContainerLogsFunc retrieves recent logs for a container ID from its
// connected agent. Implementations should apply their own timeout. This is a
// type alias (not a defined type) so it satisfies the hubLike interface in
// internal/hub/systems, which declares the same func signature without
// importing this package.
type FetchContainerLogsFunc = func(containerID string) (string, error)

// containerAlertTarget is an immutable snapshot of the fields needed after the
// alert fires. Keeping agent-owned container records out of notification work
// avoids retaining and concurrently reading data that is refreshed in place.
type containerAlertTarget struct {
	id   string
	name string
}

// HandleContainerAlerts checks configured "ContainerHealth" alerts for a system
// against the Docker container health data included in the latest agent update.
// It persists when containers first become unhealthy, fires from a fresh poll
// once the configured delay has elapsed, and resolves once containers recover.
// fetchLogs is used when an alert actually fires so the notification can include
// a log excerpt (prioritizing lines containing "error"/"fatal") for context.
func (am *AlertManager) HandleContainerAlerts(systemRecord *core.Record, data *system.CombinedData, fetchLogs FetchContainerLogsFunc) error {
	alerts := am.alertsCache.GetAlertsByName(systemRecord.Id, containerAlertName)
	if len(alerts) == 0 {
		return nil
	}
	if data.Containers == nil {
		// An unknown Docker state must not resolve a triggered alert or count
		// toward the minimum unhealthy duration.
		var result error
		for _, alertData := range alerts {
			if err := am.clearPendingContainerAlert(alertData); err != nil {
				result = errors.Join(result, err)
			}
		}
		return result
	}

	var unhealthy []*container.Stats
	for _, c := range data.Containers {
		if c.Health == container.DockerHealthUnhealthy {
			unhealthy = append(unhealthy, c)
		}
	}

	systemName := systemRecord.GetString("name")
	now := time.Now().UTC()
	var result error
	for _, alertData := range alerts {
		if len(unhealthy) > 0 {
			if alertData.Triggered {
				continue
			}
			min := max(1, int(alertData.Min))
			if alertData.PendingSince.IsZero() {
				pendingSince, err := am.setPendingContainerAlert(alertData, now)
				if err != nil {
					result = errors.Join(result, err)
					continue
				}
				if pendingSince.IsZero() {
					continue
				}
				alertData.PendingSince = pendingSince
				if min > 1 {
					continue
				}
			}
			if min > 1 && now.Before(alertData.PendingSince.Add(time.Duration(min)*time.Minute)) {
				continue
			}
			if err := am.sendContainerHealthAlert(true, systemName, alertData, snapshotContainerAlertTargets(unhealthy), fetchLogs); err != nil {
				result = errors.Join(result, err)
			}
			continue
		}

		// no unhealthy containers right now
		if err := am.clearPendingContainerAlert(alertData); err != nil {
			result = errors.Join(result, err)
		}
		if !alertData.Triggered {
			continue
		}
		if err := am.sendContainerHealthAlert(false, systemName, alertData, nil, fetchLogs); err != nil {
			result = errors.Join(result, err)
		}
	}
	return result
}

func snapshotContainerAlertTargets(containers []*container.Stats) []containerAlertTarget {
	targets := make([]containerAlertTarget, len(containers))
	for i, c := range containers {
		targets[i] = containerAlertTarget{id: c.Id, name: c.Name}
	}
	return targets
}

// setPendingContainerAlert durably records the first unhealthy observation and
// returns the persisted generation used to claim delivery.
func (am *AlertManager) setPendingContainerAlert(alertData CachedAlertData, since time.Time) (time.Time, error) {
	record, err := am.hub.FindRecordById("alerts", alertData.Id)
	if err != nil {
		return time.Time{}, err
	}
	if record.GetBool("triggered") {
		return time.Time{}, nil
	}
	if pendingSince := record.GetDateTime("pending_since").Time(); !pendingSince.IsZero() {
		return pendingSince, nil
	}
	// PocketBase date fields are persisted with millisecond precision. Normalize
	// before saving so the update-hook cache and a subsequent database read agree.
	since = since.Truncate(time.Millisecond)
	record.Set("pending_since", since)
	return since, am.hub.Save(record)
}

func (am *AlertManager) clearPendingContainerAlert(alertData CachedAlertData) error {
	if alertData.PendingSince.IsZero() {
		return nil
	}
	record, err := am.hub.FindRecordById("alerts", alertData.Id)
	if err != nil {
		return err
	}
	if record.GetDateTime("pending_since").Time().IsZero() {
		return nil
	}
	record.Set("pending_since", nil)
	return am.hub.Save(record)
}

// claimPendingContainerAlert marks an alert triggered only if the pending
// generation is still current. A healthy/unknown update can clear the timestamp
// while logs are being fetched, causing this claim to become a no-op.
func (am *AlertManager) claimPendingContainerAlert(alertData CachedAlertData) (bool, error) {
	record, err := am.hub.FindRecordById("alerts", alertData.Id)
	if err != nil {
		return false, err
	}
	pendingSince := record.GetDateTime("pending_since").Time()
	if record.GetBool("triggered") || pendingSince.IsZero() || pendingSince.UnixMilli() != alertData.PendingSince.UnixMilli() {
		return false, nil
	}
	record.Set("pending_since", nil)
	record.Set("triggered", true)
	return true, am.hub.Save(record)
}

// CancelPendingContainerAlerts clears pending container-health durations for a
// system. Called when monitoring pauses or the system goes down.
func (am *AlertManager) CancelPendingContainerAlerts(systemID string) {
	for _, alertData := range am.alertsCache.GetAlertsByName(systemID, containerAlertName) {
		if err := am.clearPendingContainerAlert(alertData); err != nil {
			am.hub.Logger().Error("Failed to clear pending container alert", "err", err)
		}
	}
}

// sendContainerHealthAlert updates the alert's triggered state and sends the
// notification. When unhealthy is true, it embeds a log excerpt (prioritizing
// error/fatal lines) for up to containerAlertMaxLogged of the affected containers.
func (am *AlertManager) sendContainerHealthAlert(unhealthy bool, systemName string, alertData CachedAlertData, containers []containerAlertTarget, fetchLogs FetchContainerLogsFunc) error {
	link := am.hub.MakeLink("system", alertData.SystemID)
	linkText := viewSystemLink(systemName)

	if !unhealthy {
		if err := am.setAlertTriggered(alertData, false); err != nil {
			return err
		}
		message := M("container.healthy", Args{"system": systemName})
		return am.SendAlert(AlertMessageData{
			UserID:     alertData.UserID,
			SystemID:   alertData.SystemID,
			SystemName: systemName,
			Title:      message,
			Message:    message,
			Status:     AlertStatusResolved,
			Emoji:      "✅",
			Link:       link,
			LinkText:   linkText,
		})
	}

	names := make([]string, len(containers))
	for i, c := range containers {
		names[i] = c.name
	}

	title := M("container.unhealthy_many", Args{"count": len(names), "system": systemName})
	targetLabel := M("target.containers", nil)
	if len(names) == 1 {
		title = M("container.unhealthy_one", Args{"container": names[0], "system": systemName})
		targetLabel = M("target.container", nil)
	}
	details := am.buildContainerLogDetails(containers, fetchLogs)

	claimed, err := am.claimPendingContainerAlert(alertData)
	if err != nil || !claimed {
		return err
	}

	return am.SendAlert(AlertMessageData{
		UserID:      alertData.UserID,
		SystemID:    alertData.SystemID,
		SystemName:  systemName,
		Title:       title,
		Message:     M("container.unhealthy_list", Args{"containers": names}),
		Target:      RawMsg(strings.Join(names, ", ")),
		TargetLabel: targetLabel,
		Details:     details,
		Status:      AlertStatusTriggered,
		Emoji:       "\U0001F534",
		Link:        link,
		LinkText:    linkText,
	})
}

// buildContainerLogDetails attempts to fetch log excerpts for up to
// containerAlertMaxLogged unhealthy containers, to show below an alert message.
func (am *AlertManager) buildContainerLogDetails(containers []containerAlertTarget, fetchLogs FetchContainerLogsFunc) []AlertDetail {
	if fetchLogs == nil {
		return nil
	}

	var details []AlertDetail
	attempts := min(len(containers), containerAlertMaxLogged)
	for _, c := range containers[:attempts] {
		rawLogs, err := fetchLogs(c.id)
		if err != nil {
			am.hub.Logger().Warn("Failed to fetch container logs for alert", "container", c.name, "err", err)
			continue
		}
		excerpt := buildContainerLogExcerpt(rawLogs)
		if excerpt == "" {
			continue
		}
		details = append(details, AlertDetail{Label: M("container.logs", Args{"container": c.name}), Text: excerpt})
	}

	if len(containers) > containerAlertMaxLogged {
		details = append(details, AlertDetail{Label: M("container.logs_omitted", Args{"count": len(containers) - containerAlertMaxLogged})})
	}

	return details
}

// buildContainerLogExcerpt filters raw container log output down to the lines
// most likely to explain why the container is unhealthy: lines containing
// "error" or "fatal" (case-insensitive) are preferred. If none match, the tail
// of the raw output is used instead so the notification still carries context.
func buildContainerLogExcerpt(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	lines := strings.Split(raw, "\n")

	var matched []string
	for _, line := range lines {
		line = strings.TrimRight(line, "\r")
		if line == "" {
			continue
		}
		lower := strings.ToLower(line)
		if strings.Contains(lower, "error") || strings.Contains(lower, "fatal") {
			matched = append(matched, line)
		}
	}

	selected := matched
	if len(selected) == 0 {
		start := max(0, len(lines)-containerLogFallbackLines)
		selected = lines[start:]
	} else if len(selected) > containerLogMaxLines {
		selected = selected[len(selected)-containerLogMaxLines:]
	}

	excerpt := strings.TrimSpace(strings.Join(selected, "\n"))
	if len(excerpt) > containerLogExcerptMaxChars {
		excerpt = "…" + excerpt[len(excerpt)-containerLogExcerptMaxChars:]
	}
	return excerpt
}
