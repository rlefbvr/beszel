//go:build testing

package alerts_test

import (
	"testing"
	"time"

	"github.com/henrygd/beszel/internal/alerts"
	beszelTests "github.com/henrygd/beszel/internal/tests"
	"github.com/pocketbase/dbx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// An expiry alert triggers under its threshold, with a history record, and
// resolves once a certificate of the same name is renewed.
func TestCertificateAlerts(t *testing.T) {
	hub, user := beszelTests.GetHubWithUser(t)
	defer hub.Cleanup()
	systems, err := beszelTests.CreateSystems(hub, 1, user.Id, "up")
	require.NoError(t, err)
	system := systems[0]

	now := time.Now().UTC()
	cert, err := beszelTests.CreateRecord(hub, "certificates", map[string]any{
		"system": system.Id, "key": "file:/etc/ssl/site.pem", "name": "www.example.com",
		"not_after": now.Add(10 * 24 * time.Hour), "uses": []map[string]string{{"kind": "nginx"}},
	})
	require.NoError(t, err)
	// an old copy of the certificate left unused does not count while one is in use
	_, err = beszelTests.CreateRecord(hub, "certificates", map[string]any{
		"system": system.Id, "key": "file:/root/old.pem", "name": "www.example.com",
		"not_after": now.Add(-5 * 24 * time.Hour),
	})
	require.NoError(t, err)
	rule, err := beszelTests.CreateRecord(hub, "certificate_alerts", map[string]any{
		"user": user.Id, "system": system.Id, "name": "WWW.example.com", "days": 30,
	})
	require.NoError(t, err)

	am := alerts.NewAlertManager(hub)
	defer am.Stop()
	require.NoError(t, am.HandleCertificateAlerts(system.Id))
	rule, err = hub.FindRecordById("certificate_alerts", rule.Id)
	require.NoError(t, err)
	assert.True(t, rule.GetBool("triggered"))
	history, err := hub.FindRecordById("alerts_history", rule.GetString("history"))
	require.NoError(t, err)
	assert.Equal(t, "Certificate", history.GetString("name"))
	assert.Equal(t, "WWW.example.com", history.GetString("monitor_name"))
	assert.EqualValues(t, 9, history.GetFloat("value"))

	// renewed
	cert.Set("not_after", now.Add(90*24*time.Hour))
	require.NoError(t, hub.Save(cert))
	require.NoError(t, am.HandleCertificateAlerts(system.Id))
	rule, err = hub.FindRecordById("certificate_alerts", rule.Id)
	require.NoError(t, err)
	assert.False(t, rule.GetBool("triggered"))
	assert.Empty(t, rule.GetString("history"))
	open, err := hub.FindAllRecords("alerts_history", dbx.HashExp{"name": "Certificate", "resolved": ""})
	require.NoError(t, err)
	assert.Empty(t, open)
}
