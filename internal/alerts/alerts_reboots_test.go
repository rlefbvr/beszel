//go:build testing

package alerts_test

import (
	"testing"
	"time"

	"github.com/henrygd/beszel/internal/alerts"
	beszelTests "github.com/henrygd/beszel/internal/tests"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOutageNotifications(t *testing.T) {
	hub, user := beszelTests.GetHubWithUser(t)
	defer hub.Cleanup()
	systems, err := beszelTests.CreateSystems(hub, 1, user.Id, "up")
	require.NoError(t, err)
	system := systems[0]
	am := alerts.NewAlertManager(hub)
	defer am.Stop()

	now := time.Now().UTC()
	shutdown := now.Add(-10 * time.Minute)
	until := now.Add(time.Minute)

	assert.Empty(t, am.OutageNotifications(system, shutdown, until), "no status alert and no quiet hours")

	// the status alert fired during the outage (history created now)
	_, err = beszelTests.CreateRecord(hub, "alerts_history", map[string]any{
		"user":   user.Id,
		"system": system.Id,
		"name":   "Status",
		"value":  0,
	})
	require.NoError(t, err)
	assert.Equal(t, map[string]string{user.Id: alerts.OutageAlertSent}, am.OutageNotifications(system, shutdown, until))
	assert.Empty(t, am.OutageNotifications(system, now.Add(-3*time.Hour), now.Add(-2*time.Hour)), "alerts outside the outage are ignored")

	// quiet hours silenced it
	_, err = beszelTests.CreateRecord(hub, "quiet_hours", map[string]any{
		"user":   user.Id,
		"system": system.Id,
		"type":   "one-time",
		"start":  now.Add(-time.Hour),
		"end":    now.Add(time.Hour),
	})
	require.NoError(t, err)
	assert.Equal(t, map[string]string{user.Id: alerts.OutageAlertQuiet}, am.OutageNotifications(system, shutdown, until))
}
