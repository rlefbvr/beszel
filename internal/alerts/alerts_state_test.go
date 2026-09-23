//go:build testing

package alerts_test

import (
	"net/http"
	"testing"

	"github.com/henrygd/beszel/internal/alerts"
	"github.com/henrygd/beszel/internal/entities/container"
	esystem "github.com/henrygd/beszel/internal/entities/system"
	"github.com/henrygd/beszel/internal/entities/systemd"
	beszelTests "github.com/henrygd/beszel/internal/tests"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	pbTests "github.com/pocketbase/pocketbase/tests"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// stateAlertSetup creates a user with an email, an up system and a state rule.
func stateAlertSetup(t *testing.T, rule map[string]any) (*beszelTests.TestHub, *core.Record, *core.Record) {
	t.Helper()
	hub, system, alert := systemdTestSetup(t, false)
	t.Cleanup(hub.Cleanup)
	require.NoError(t, hub.Delete(alert))
	_, err := hub.DB().Update("systems", dbx.Params{"status": "up"}, dbx.HashExp{"id": system.Id}).Execute()
	require.NoError(t, err)
	system.Set("status", "up")

	fields := map[string]any{
		"user":      alert.GetString("user"),
		"system":    system.Id,
		"condition": "is_not",
		"cycles":    1,
	}
	for k, v := range rule {
		fields[k] = v
	}
	record, err := beszelTests.CreateRecord(hub, "state_alerts", fields)
	require.NoError(t, err)
	return hub, system, record
}

// checkStateAlert asserts the rule's triggered flag, open incidents and sent notifications.
func checkStateAlert(t *testing.T, hub *beszelTests.TestHub, rule *core.Record, triggered bool, open int, sent int) {
	t.Helper()
	record, err := hub.FindRecordById("state_alerts", rule.Id)
	require.NoError(t, err)
	assert.Equal(t, triggered, record.GetBool("triggered"))
	total, err := hub.CountRecords("alerts_history", dbx.HashExp{"alert_id": rule.Id, "resolved": ""})
	require.NoError(t, err)
	assert.EqualValues(t, open, total)
	assert.Equal(t, sent, int(hub.TestMailer.TotalSend()))
}

func TestServiceStateAlert(t *testing.T) {
	hub, system, rule := stateAlertSetup(t, map[string]any{
		"kind": "service", "targets": "a", "states": []string{"active"},
	})
	am := alerts.NewTestAlertManagerWithoutWorker(hub)
	sent := int(hub.TestMailer.TotalSend())

	seedServicesAt(t, hub, system.Id, 1000, systemd.StatusActive)
	require.NoError(t, am.HandleStateAlerts(system, nil))
	checkStateAlert(t, hub, rule, false, 0, sent)

	seedServicesAt(t, hub, system.Id, 2000, systemd.StatusFailed)
	require.NoError(t, am.HandleStateAlerts(system, nil))
	checkStateAlert(t, hub, rule, true, 1, sent+1)
	message := hub.TestMailer.Messages()[sent]
	assert.Contains(t, message.Subject, "a.service")
	assert.Contains(t, message.Text, "failed")

	// the same snapshot is only evaluated once
	require.NoError(t, am.HandleStateAlerts(system, nil))
	checkStateAlert(t, hub, rule, true, 1, sent+1)

	seedServicesAt(t, hub, system.Id, 3000, systemd.StatusActive)
	require.NoError(t, am.HandleStateAlerts(system, nil))
	checkStateAlert(t, hub, rule, false, 0, sent+2)

	histories, err := hub.FindAllRecords("alerts_history", dbx.HashExp{"alert_id": rule.Id})
	require.NoError(t, err)
	require.Len(t, histories, 1)
	assert.Equal(t, "ServiceState", histories[0].GetString("name"))
	assert.Equal(t, "a.service", histories[0].GetString("monitor_name"))
}

func TestServiceStateAlertCycles(t *testing.T) {
	hub, system, rule := stateAlertSetup(t, map[string]any{
		"kind": "service", "targets": "a", "condition": "is", "states": []string{"failed"}, "cycles": 2,
	})
	am := alerts.NewTestAlertManagerWithoutWorker(hub)
	sent := int(hub.TestMailer.TotalSend())

	seedServicesAt(t, hub, system.Id, 1000, systemd.StatusFailed)
	require.NoError(t, am.HandleStateAlerts(system, nil))
	checkStateAlert(t, hub, rule, false, 0, sent)

	seedServicesAt(t, hub, system.Id, 2000, systemd.StatusFailed)
	require.NoError(t, am.HandleStateAlerts(system, nil))
	checkStateAlert(t, hub, rule, true, 1, sent+1)
}

func TestServiceStateAlertMissingService(t *testing.T) {
	// literal targets are also matched against the Windows short name in parentheses
	hub, system, rule := stateAlertSetup(t, map[string]any{
		"kind": "service", "targets": "Spooler, sshd", "states": []string{"active"},
	})
	am := alerts.NewTestAlertManagerWithoutWorker(hub)
	sent := int(hub.TestMailer.TotalSend())

	setSystemdServiceState(t, hub, system.Id, "Print Spooler (Spooler)", systemd.StatusActive, 1000)
	setSystemdServiceState(t, hub, system.Id, "sshd.service", systemd.StatusActive, 1000)
	require.NoError(t, am.HandleStateAlerts(system, nil))
	checkStateAlert(t, hub, rule, false, 0, sent)

	// sshd is no longer reported
	setSystemdServiceState(t, hub, system.Id, "Print Spooler (Spooler)", systemd.StatusActive, 2000)
	require.NoError(t, am.HandleStateAlerts(system, nil))
	checkStateAlert(t, hub, rule, true, 1, sent+1)
	assert.Contains(t, hub.TestMailer.Messages()[sent].Text, "absent")
}

func TestContainerStateAlert(t *testing.T) {
	hub, system, rule := stateAlertSetup(t, map[string]any{
		"kind": "container", "targets": "web*", "states": []string{"running"}, "sub_states": []string{"healthy", "none"},
	})
	am := alerts.NewTestAlertManagerWithoutWorker(hub)
	sent := int(hub.TestMailer.TotalSend())
	report := func(containers ...*container.Stats) *esystem.CombinedData {
		return &esystem.CombinedData{Containers: containers}
	}

	require.NoError(t, am.HandleStateAlerts(system, report(&container.Stats{Name: "web-1", Status: "Up 2 hours", Health: container.DockerHealthHealthy})))
	checkStateAlert(t, hub, rule, false, 0, sent)

	require.NoError(t, am.HandleStateAlerts(system, report(&container.Stats{Name: "web-1", Status: "Up 2 hours", Health: container.DockerHealthUnhealthy})))
	checkStateAlert(t, hub, rule, true, 1, sent+1)
	assert.Contains(t, hub.TestMailer.Messages()[sent].Text, "running (unhealthy)")

	// missing Docker data must not be read as stopped containers
	require.NoError(t, am.HandleStateAlerts(system, &esystem.CombinedData{}))
	checkStateAlert(t, hub, rule, true, 1, sent+1)

	// a previously seen container missing from the report is stopped
	require.NoError(t, am.HandleStateAlerts(system, report(&container.Stats{Name: "web-2", Status: "Up 1 second"})))
	checkStateAlert(t, hub, rule, true, 1, sent+1)

	require.NoError(t, am.HandleStateAlerts(system, report(
		&container.Stats{Name: "web-1", Status: "Up 1 second"},
		&container.Stats{Name: "web-2", Status: "Up 1 minute (Paused)"},
	)))
	checkStateAlert(t, hub, rule, true, 1, sent+3)
	assert.Contains(t, hub.TestMailer.Messages()[sent+1].Subject+hub.TestMailer.Messages()[sent+2].Subject, "paused")
}

func TestStateAlertResolvedOnRuleChange(t *testing.T) {
	hub, system, rule := stateAlertSetup(t, map[string]any{
		"kind": "container", "targets": "db", "states": []string{"running"},
	})
	am := alerts.NewTestAlertManagerWithoutWorker(hub)

	require.NoError(t, am.HandleStateAlerts(system, &esystem.CombinedData{Containers: []*container.Stats{}}))
	checkStateAlert(t, hub, rule, true, 1, int(hub.TestMailer.TotalSend()))

	require.NoError(t, hub.Delete(rule))
	total, err := hub.CountRecords("alerts_history", dbx.HashExp{"alert_id": rule.Id, "resolved": ""})
	require.NoError(t, err)
	assert.Zero(t, total)
}

func TestStateAlertIgnoresDownSystem(t *testing.T) {
	hub, system, rule := stateAlertSetup(t, map[string]any{
		"kind": "container", "targets": "db", "states": []string{"running"},
	})
	am := alerts.NewTestAlertManagerWithoutWorker(hub)
	sent := int(hub.TestMailer.TotalSend())

	system.Set("status", "down")
	require.NoError(t, am.HandleStateAlerts(system, &esystem.CombinedData{Containers: []*container.Stats{}}))
	checkStateAlert(t, hub, rule, false, 0, sent)
}

// TestStateAlertsApi runs each scenario on a fresh hub: starting the hub twice on
// one test app registers its routes twice and panics.
func TestStateAlertsApi(t *testing.T) {
	type env struct {
		hub                    *beszelTests.TestHub
		user1, user2           *core.Record
		user1Token, user2Token string
		system1                *core.Record
	}
	setup := func(t *testing.T) env {
		hub, err := beszelTests.NewTestHub(t.TempDir())
		require.NoError(t, err)
		t.Cleanup(hub.Cleanup)
		hub.StartHub()
		var e env
		e.hub = hub
		e.user1, _ = beszelTests.CreateUser(hub, "stateapi1@example.com", "password")
		e.user1Token, _ = e.user1.NewAuthToken()
		e.user2, _ = beszelTests.CreateUser(hub, "stateapi2@example.com", "password")
		e.user2Token, _ = e.user2.NewAuthToken()
		e.system1, _ = beszelTests.CreateRecord(hub, "systems", map[string]any{
			"name": "system1", "users": []string{e.user1.Id}, "host": "127.0.0.1",
		})
		return e
	}
	rule := func(e env, user string, overrides map[string]any) map[string]any {
		body := map[string]any{
			"user": user, "system": e.system1.Id, "kind": "service", "targets": "nginx",
			"condition": "is_not", "states": []string{"active"}, "cycles": 1,
		}
		for k, v := range overrides {
			body[k] = v
		}
		return body
	}

	cases := []struct {
		name     string
		token    func(env) string
		body     func(env) map[string]any
		status   int
		contains []string
	}{
		{
			name:  "create valid rule ignores client state",
			token: func(e env) string { return e.user1Token },
			body: func(e env) map[string]any {
				return rule(e, e.user1.Id, map[string]any{"triggered": true, "state": map[string]any{"t": map[string]any{"x": map[string]any{"h": "abc"}}}})
			},
			status:   200,
			contains: []string{`"triggered":false`, `"targets":"nginx"`},
		},
		{
			name:     "invalid state for kind",
			token:    func(e env) string { return e.user1Token },
			body:     func(e env) map[string]any { return rule(e, e.user1.Id, map[string]any{"kind": "container"}) },
			status:   400,
			contains: []string{"nvalid state"},
		},
		{
			name:     "no states",
			token:    func(e env) string { return e.user1Token },
			body:     func(e env) map[string]any { return rule(e, e.user1.Id, map[string]any{"states": []string{}}) },
			status:   400,
			contains: []string{"elect at least one state"},
		},
		{
			name:     "system of another user",
			token:    func(e env) string { return e.user2Token },
			body:     func(e env) map[string]any { return rule(e, e.user2.Id, nil) },
			status:   403,
			contains: []string{"do not have access"},
		},
		{
			name:     "rule for another user",
			token:    func(e env) string { return e.user1Token },
			body:     func(e env) map[string]any { return rule(e, e.user2.Id, nil) },
			status:   400,
			contains: []string{`"data":{}`},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e := setup(t)
			scenario := beszelTests.ApiScenario{
				Name:            tc.name,
				Method:          http.MethodPost,
				URL:             "/api/collections/state_alerts/records",
				Headers:         map[string]string{"Authorization": tc.token(e)},
				Body:            jsonReader(tc.body(e)),
				ExpectedStatus:  tc.status,
				ExpectedContent: tc.contains,
				TestAppFactory:  func(t testing.TB) *pbTests.TestApp { return e.hub.TestApp },
			}
			scenario.Test(t)
		})
	}
}
