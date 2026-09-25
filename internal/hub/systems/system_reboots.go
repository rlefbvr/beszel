package systems

import (
	"context"
	"sync/atomic"
	"time"

	"github.com/henrygd/beszel/internal/common"
	"github.com/henrygd/beszel/internal/entities/system"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

const rebootsCollection = "system_reboots"

// bootTolerance absorbs the jitter of boot times derived from the uptime, and
// the difference between them and the boot times of the host logs.
const bootTolerance = 2 * time.Minute

// bootTracker follows the boots of a system to record its reboots. Its fields
// are only used from the system update loop, except syncing.
type bootTracker struct {
	loaded   bool      // lastBoot was initialized
	lastBoot time.Time // boot of the run being monitored
	lastSeen time.Time // last successful update, the end of the run before a reboot
	syncing  atomic.Bool
}

// trackBoot records a reboot when the boot time derived from the uptime moves
// forward, then completes the history from the host logs.
func (sys *System) trackBoot(uptime uint64, now time.Time) {
	now = now.UTC()
	tracker := &sys.boots
	lastSeen := tracker.lastSeen
	tracker.lastSeen = now
	if uptime == 0 {
		return
	}
	boot := now.Add(-time.Duration(uptime) * time.Second).Truncate(time.Second)

	if !tracker.loaded {
		tracker.loaded = true
		last, found := sys.lastRecordedBoot()
		if !found {
			// first run: read the reboot history from the host logs
			tracker.lastBoot = boot
			sys.syncBootEvents(time.Time{})
			return
		}
		tracker.lastBoot = last
	}

	switch previous := tracker.lastBoot; {
	case boot.Sub(previous) < -bootTolerance:
		// clock or uptime adjusted backwards: follow the new value
		tracker.lastBoot = boot
	case boot.Sub(previous) >= bootTolerance:
		tracker.lastBoot = boot
		// the run ended after the last update seen, when seen by this hub process
		var shutdown time.Time
		if !lastSeen.IsZero() && lastSeen.After(previous) && lastSeen.Before(boot) {
			shutdown = lastSeen
		}
		sys.saveBootEvent(system.BootEvent{Boot: boot, Shutdown: shutdown}, system.BootSourceUptime, now)
		sys.syncBootEvents(previous)
	}
}

// lastRecordedBoot returns the most recent recorded boot of the system.
func (sys *System) lastRecordedBoot() (time.Time, bool) {
	records, err := sys.manager.hub.FindRecordsByFilter(rebootsCollection, "system={:system}", "-boot", 1, 0, dbx.Params{"system": sys.Id})
	if err != nil || len(records) == 0 {
		return time.Time{}, false
	}
	return records[0].GetDateTime("boot").Time(), true
}

// syncBootEvents asks the agent for the boots after since found in the host
// logs and records them. Agents without this request, or without readable
// logs, are ignored: their reboots come from the uptime only.
func (sys *System) syncBootEvents(since time.Time) {
	if !sys.boots.syncing.CompareAndSwap(false, true) {
		return
	}
	go func() {
		defer sys.boots.syncing.Store(false)
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		var response system.BootEventsResponse
		if err := sys.forkRequest(ctx, common.GetBootEvents, common.BootEventsRequest{Since: since}, &response); err != nil {
			sys.manager.hub.Logger().Debug("Boot events unavailable", "system", sys.Id, "err", err)
			return
		}
		for _, event := range response.Events {
			sys.saveBootEvent(event, response.Source, event.Boot.Add(10*time.Minute))
		}
	}()
}

// saveBootEvent creates the reboot record of a boot, or completes the record
// of the same boot with the details of the host logs. detectedAt bounds the
// search for the status alerts of the outage.
func (sys *System) saveBootEvent(event system.BootEvent, source string, detectedAt time.Time) {
	hub := sys.manager.hub
	existing, _ := hub.FindFirstRecordByFilter(rebootsCollection, "system={:system} && boot>={:from} && boot<={:to}", dbx.Params{
		"system": sys.Id,
		"from":   event.Boot.Add(-bootTolerance).UTC().Format(types.DefaultDateLayout),
		"to":     event.Boot.Add(bootTolerance).UTC().Format(types.DefaultDateLayout),
	})

	record := existing
	// notification outcomes are computed on creation, or once the shutdown time is known
	computeAlerts := existing == nil || (existing.GetDateTime("shutdown").IsZero() && !event.Shutdown.IsZero())
	if record == nil {
		collection, err := hub.FindCachedCollectionByNameOrId(rebootsCollection)
		if err != nil {
			return
		}
		record = core.NewRecord(collection)
		record.Set("system", sys.Id)
	} else if source == system.BootSourceUptime {
		// the boot is already known, from the logs or a previous detection
		return
	}

	record.Set("boot", event.Boot.UTC())
	record.Set("source", source)
	if !event.Shutdown.IsZero() {
		record.Set("shutdown", event.Shutdown.UTC())
	}
	record.Set("unexpected", event.Unexpected)
	record.Set("reason", event.Reason)
	record.Set("user", event.User)

	if computeAlerts {
		if systemRecord, err := sys.getRecord(hub); err == nil {
			shutdown := record.GetDateTime("shutdown").Time()
			record.Set("alerts", hub.OutageNotifications(systemRecord, shutdown, detectedAt))
		}
	}

	if err := hub.SaveNoValidate(record); err != nil {
		hub.Logger().Error("Failed to save reboot", "system", sys.Id, "err", err)
	}
}
