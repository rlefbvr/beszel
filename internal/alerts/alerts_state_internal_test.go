//go:build testing

package alerts

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestStateAlertNameMatching(t *testing.T) {
	rule := stateAlertRule{patterns: parseStateAlertPatterns(" Spooler, nginx , sql* ,")}
	assert.Equal(t, []string{"spooler", "nginx", "sql*"}, rule.patterns)

	for name, want := range map[string]bool{
		"Print Spooler (Spooler)":  true,
		"nginx.service":            true,
		"nginx-proxy.service":      false,
		"SQL Server (MSSQLSERVER)": true,
		"mssql.service":            false,
		"sqlite-backup":            true,
	} {
		assert.Equal(t, want, rule.matchesName(name), name)
	}
}

func TestStateAlertFires(t *testing.T) {
	mustRun := stateAlertRule{condition: stateAlertConditionIsNot, states: []string{"active"}, subStates: []string{"running"}}
	assert.False(t, mustRun.fires(observedState{"active", "running"}))
	assert.True(t, mustRun.fires(observedState{"active", "exited"}))
	assert.True(t, mustRun.fires(observedState{serviceStateAbsent, ""}))

	failed := stateAlertRule{condition: stateAlertConditionIs, states: []string{"failed"}}
	assert.True(t, failed.fires(observedState{"failed", "failed"}))
	assert.False(t, failed.fires(observedState{serviceStateAbsent, ""}))

	unhealthy := stateAlertRule{condition: stateAlertConditionIs, subStates: []string{"unhealthy"}}
	assert.True(t, unhealthy.fires(observedState{"running", "unhealthy"}))
	assert.False(t, unhealthy.fires(observedState{"running", "healthy"}))
}

func TestContainerStateFromStatus(t *testing.T) {
	for status, want := range map[string]string{
		"Up 2 hours":                   "running",
		"Up 2 hours (healthy)":         "running",
		"Up 5 minutes (Paused)":        "paused",
		"Restarting (1) 3 seconds ago": "restarting",
		"Exited (0) 1 minute ago":      containerStateStopped,
		"":                             "running",
	} {
		assert.Equal(t, want, containerStateFromStatus(status), status)
	}
}

func TestStateAlertTargetNames(t *testing.T) {
	rule := stateAlertRule{patterns: []string{"web*", "db", "spooler"}}
	observed := map[string]observedState{"web-1": {}, "cache": {}, "Print Spooler (Spooler)": {}}
	known := map[string]*stateAlertTarget{"web-old": {}}
	// literal "db" matches nothing and is tracked as missing; "spooler" matches a reported service
	assert.Equal(t, []string{"Print Spooler (Spooler)", "db", "web-1", "web-old"}, stateAlertTargetNames(rule, observed, known))
}
