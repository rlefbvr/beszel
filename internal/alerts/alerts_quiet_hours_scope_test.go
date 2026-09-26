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

// A window limited to some alert types or rules silences only them; a window
// without them silences everything, including the calls without alert type.
func TestQuietHoursScope(t *testing.T) {
	hub, user := beszelTests.GetHubWithUser(t)
	defer hub.Cleanup()
	systems, err := beszelTests.CreateSystems(hub, 1, user.Id, "up")
	require.NoError(t, err)
	system := systems[0]
	rule, err := beszelTests.CreateRecord(hub, "state_alerts", map[string]any{
		"user": user.Id, "system": system.Id, "kind": "service", "targets": "nginx", "condition": "is",
		"states": []string{"failed"}, "cycles": 1,
	})
	require.NoError(t, err)

	now := time.Now().UTC()
	window, err := beszelTests.CreateRecord(hub, "quiet_hours", map[string]any{
		"user": user.Id, "system": system.Id, "type": "one-time",
		"start": now.Add(-time.Hour), "end": now.Add(time.Hour),
		"alerts": []string{"CPU"}, "rules": []string{rule.Id},
	})
	require.NoError(t, err)

	am := alerts.NewAlertManager(hub)
	defer am.Stop()
	assert.True(t, am.IsAlertSilenced(user.Id, system.Id, "CPU", ""), "chosen alert type")
	assert.False(t, am.IsAlertSilenced(user.Id, system.Id, "Memory", ""), "other alert type")
	assert.True(t, am.IsAlertSilenced(user.Id, system.Id, "ServiceState", rule.Id), "chosen rule")
	assert.False(t, am.IsAlertSilenced(user.Id, system.Id, "ServiceState", "otherrule"), "other rule")
	assert.False(t, am.IsNotificationSilenced(user.Id, system.Id), "status alerts are not in the window")

	window.Set("alerts", []string{})
	window.Set("rules", []string{})
	require.NoError(t, hub.Save(window))
	assert.True(t, am.IsAlertSilenced(user.Id, system.Id, "Memory", ""), "all the alerts")
	assert.True(t, am.IsNotificationSilenced(user.Id, system.Id), "all the alerts")
}
