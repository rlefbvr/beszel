//go:build testing

package systems_test

import (
	"testing"
	"time"

	"github.com/henrygd/beszel/internal/entities/system"
	"github.com/henrygd/beszel/internal/tests"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func reboots(t *testing.T, hub *tests.TestHub, systemID string) []*core.Record {
	t.Helper()
	records, err := hub.FindRecordsByFilter("system_reboots", "system={:system}", "boot", 0, 0, dbx.Params{"system": systemID})
	require.NoError(t, err)
	return records
}

func TestSaveBootEventMergesUptimeAndLogs(t *testing.T) {
	hub, user := tests.GetHubWithUser(t)
	defer hub.Cleanup()
	systemRecords, err := tests.CreateSystems(hub, 1, user.Id, "paused")
	require.NoError(t, err)
	sys, err := hub.GetSystemManager().GetSystem(systemRecords[0].Id)
	require.NoError(t, err)

	boot := time.Date(2026, 9, 20, 8, 0, 0, 0, time.UTC)
	sys.SaveBootEvent(system.BootEvent{Boot: boot}, system.BootSourceUptime, boot.Add(time.Minute))
	// the same boot seen again from the uptime is ignored
	sys.SaveBootEvent(system.BootEvent{Boot: boot.Add(20 * time.Second)}, system.BootSourceUptime, boot.Add(2*time.Minute))
	records := reboots(t, hub, systemRecords[0].Id)
	require.Len(t, records, 1)
	assert.Equal(t, "uptime", records[0].GetString("source"))
	assert.True(t, records[0].GetDateTime("shutdown").IsZero())

	// the host logs complete the record of the same boot
	shutdown := boot.Add(-3 * time.Minute)
	sys.SaveBootEvent(system.BootEvent{
		Boot: boot.Add(-30 * time.Second), Shutdown: shutdown, Unexpected: true, Reason: "Windows Update", User: "TrustedInstaller.exe",
	}, system.BootSourceEventLog, boot.Add(10*time.Minute))
	records = reboots(t, hub, systemRecords[0].Id)
	require.Len(t, records, 1)
	record := records[0]
	assert.Equal(t, "eventlog", record.GetString("source"))
	assert.Equal(t, boot.Add(-30*time.Second), record.GetDateTime("boot").Time(), "the logs give the exact boot time")
	assert.Equal(t, shutdown, record.GetDateTime("shutdown").Time())
	assert.True(t, record.GetBool("unexpected"))
	assert.Equal(t, "Windows Update", record.GetString("reason"))
	assert.Equal(t, "TrustedInstaller.exe", record.GetString("user"))

	// another boot from the logs creates a record
	sys.SaveBootEvent(system.BootEvent{Boot: boot.Add(-48 * time.Hour)}, system.BootSourceJournal, boot.Add(-47*time.Hour))
	assert.Len(t, reboots(t, hub, systemRecords[0].Id), 2)
}

func TestTrackBootRecordsReboots(t *testing.T) {
	hub, user := tests.GetHubWithUser(t)
	defer hub.Cleanup()
	systemRecords, err := tests.CreateSystems(hub, 1, user.Id, "paused")
	require.NoError(t, err)
	systemID := systemRecords[0].Id
	sys, err := hub.GetSystemManager().GetSystem(systemID)
	require.NoError(t, err)

	// a known boot, so the tracker doesn't read the history from the logs
	now := time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC)
	firstBoot := now.Add(-5 * time.Hour)
	sys.SaveBootEvent(system.BootEvent{Boot: firstBoot}, system.BootSourceUptime, firstBoot)

	sys.TrackBoot(5*3600, now)
	sys.TrackBoot(5*3600+62, now.Add(time.Minute)) // uptime jitter
	require.Len(t, reboots(t, hub, systemID), 1, "same run")

	// reboot: the uptime restarts
	lastSeen := now.Add(2 * time.Minute)
	sys.TrackBoot(5*3600+120, lastSeen)
	backOnline := now.Add(6 * time.Minute)
	sys.TrackBoot(90, backOnline)
	records := reboots(t, hub, systemID)
	require.Len(t, records, 2)
	reboot := records[1]
	assert.Equal(t, backOnline.Add(-90*time.Second), reboot.GetDateTime("boot").Time())
	assert.Equal(t, lastSeen, reboot.GetDateTime("shutdown").Time(), "the run ended after the last update seen")
	assert.Equal(t, "uptime", reboot.GetString("source"))
}
