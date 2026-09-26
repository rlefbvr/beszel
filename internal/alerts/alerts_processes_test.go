//go:build testing

package alerts_test

import (
	"testing"

	"github.com/henrygd/beszel/internal/alerts"
	esystem "github.com/henrygd/beszel/internal/entities/system"
	"github.com/pocketbase/dbx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestProcessMustRunAlert(t *testing.T) {
	// "sqlservr" matches the Windows program sqlservr.exe
	hub, system, rule := stateAlertSetup(t, map[string]any{
		"kind": "process", "targets": "sqlservr", "states": []string{"running"},
	})
	am := alerts.NewTestAlertManagerWithoutWorker(hub)
	sent := int(hub.TestMailer.TotalSend())

	require.NoError(t, am.HandleProcessAlerts(system, []esystem.Process{{PID: 10, Name: "sqlservr.exe", CPU: 2}}))
	checkStateAlert(t, hub, rule, false, 0, sent)

	require.NoError(t, am.HandleProcessAlerts(system, []esystem.Process{{PID: 11, Name: "explorer.exe"}}))
	checkStateAlert(t, hub, rule, true, 1, sent+1)
	assert.Contains(t, hub.TestMailer.Messages()[sent].Subject, "sqlservr")
	assert.Contains(t, hub.TestMailer.Messages()[sent].Text, "stopped")

	require.NoError(t, am.HandleProcessAlerts(system, []esystem.Process{{PID: 12, Name: "sqlservr.exe"}}))
	checkStateAlert(t, hub, rule, false, 0, sent+2)

	histories, err := hub.FindAllRecords("alerts_history", dbx.HashExp{"alert_id": rule.Id})
	require.NoError(t, err)
	require.Len(t, histories, 1)
	assert.Equal(t, "ProcessState", histories[0].GetString("name"))
}

func TestProcessCPUAlert(t *testing.T) {
	// the instances of a program add up
	hub, system, rule := stateAlertSetup(t, map[string]any{
		"kind": "process", "targets": "chrome*", "condition": "above", "metric": "cpu", "threshold": 50, "cycles": 2,
	})
	am := alerts.NewTestAlertManagerWithoutWorker(hub)
	sent := int(hub.TestMailer.TotalSend())
	busy := []esystem.Process{{PID: 1, Name: "chrome", CPU: 30}, {PID: 2, Name: "chrome", CPU: 25}, {PID: 3, Name: "bash", CPU: 90}}

	require.NoError(t, am.HandleProcessAlerts(system, busy))
	checkStateAlert(t, hub, rule, false, 0, sent)
	require.NoError(t, am.HandleProcessAlerts(system, busy))
	checkStateAlert(t, hub, rule, true, 1, sent+1)
	assert.Contains(t, hub.TestMailer.Messages()[sent].Text, "55.0%")
	assert.Contains(t, hub.TestMailer.Messages()[sent].Text, "50.0%")

	require.NoError(t, am.HandleProcessAlerts(system, []esystem.Process{{PID: 1, Name: "chrome", CPU: 10}}))
	checkStateAlert(t, hub, rule, false, 0, sent+2)
}

func TestProcessInstancesAlert(t *testing.T) {
	hub, system, rule := stateAlertSetup(t, map[string]any{
		"kind": "process", "targets": "php-fpm", "condition": "below", "metric": "count", "threshold": 2,
	})
	am := alerts.NewTestAlertManagerWithoutWorker(hub)
	sent := int(hub.TestMailer.TotalSend())

	require.NoError(t, am.HandleProcessAlerts(system, []esystem.Process{{PID: 1, Name: "php-fpm"}, {PID: 2, Name: "php-fpm"}}))
	checkStateAlert(t, hub, rule, false, 0, sent)

	// one instance left, then none: the alert stays open
	require.NoError(t, am.HandleProcessAlerts(system, []esystem.Process{{PID: 1, Name: "php-fpm"}}))
	checkStateAlert(t, hub, rule, true, 1, sent+1)
	require.NoError(t, am.HandleProcessAlerts(system, nil))
	checkStateAlert(t, hub, rule, true, 1, sent+1)
}
