package alerts

import (
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Notification outcomes of an outage, stored per user on system reboots.
const (
	OutageAlertSent  = "sent"  // the status alert fired and was sent
	OutageAlertQuiet = "quiet" // quiet hours covered the shutdown or silenced the alert
)

// outageLookback bounds the search for status alerts when the shutdown time is unknown.
const outageLookback = time.Hour

// OutageNotifications tells, for each user of a system, how an outage that
// ended at until was notified: the status alert was sent, or quiet hours
// covered it. Users without either are omitted.
func (am *AlertManager) OutageNotifications(systemRecord *core.Record, shutdown, until time.Time) map[string]string {
	from := shutdown
	if from.IsZero() {
		from = until.Add(-outageLookback)
	}
	outcomes := make(map[string]string)
	for _, userID := range systemRecord.GetStringSlice("users") {
		// status alert triggered during the outage
		history, _ := am.hub.FindFirstRecordByFilter("alerts_history",
			"user={:user} && system={:system} && name='Status' && created>={:from} && created<={:until}",
			dbx.Params{
				"user":   userID,
				"system": systemRecord.Id,
				"from":   from.UTC().Format(types.DefaultDateLayout),
				"until":  until.UTC().Format(types.DefaultDateLayout),
			})
		at := shutdown
		if history != nil {
			at = history.GetDateTime("created").Time()
		}
		switch {
		case !at.IsZero() && am.isSilencedAt(userID, systemRecord.Id, at):
			outcomes[userID] = OutageAlertQuiet
		case history != nil:
			outcomes[userID] = OutageAlertSent
		}
	}
	return outcomes
}
