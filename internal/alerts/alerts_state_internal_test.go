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
	assert.False(t, mustRun.fires(observedState{state: "active", sub: "running"}))
	assert.True(t, mustRun.fires(observedState{state: "active", sub: "exited"}))
	assert.True(t, mustRun.fires(observedState{state: serviceStateAbsent, sub: ""}))

	failed := stateAlertRule{condition: stateAlertConditionIs, states: []string{"failed"}}
	assert.True(t, failed.fires(observedState{state: "failed", sub: "failed"}))
	assert.False(t, failed.fires(observedState{state: serviceStateAbsent, sub: ""}))

	unhealthy := stateAlertRule{condition: stateAlertConditionIs, subStates: []string{"unhealthy"}}
	assert.True(t, unhealthy.fires(observedState{state: "running", sub: "unhealthy"}))
	assert.False(t, unhealthy.fires(observedState{state: "running", sub: "healthy"}))
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

func TestProcessRuleFires(t *testing.T) {
	mustRun := stateAlertRule{condition: stateAlertConditionIsNot, states: []string{"running"}}
	assert.False(t, mustRun.fires(observedState{state: "running", count: 1}))
	assert.True(t, mustRun.fires(observedState{state: processStateStopped}))

	cpu := stateAlertRule{condition: stateAlertConditionAbove, metric: "cpu", threshold: 50}
	assert.True(t, cpu.fires(observedState{state: "running", cpu: 50.5}))
	assert.False(t, cpu.fires(observedState{state: "running", cpu: 50}))

	few := stateAlertRule{condition: stateAlertConditionBelow, metric: "count", threshold: 2}
	assert.True(t, few.fires(observedState{state: processStateStopped}))
	assert.False(t, few.fires(observedState{state: "running", count: 2}))

	// the Windows programs match without ".exe"
	rule := stateAlertRule{patterns: parseStateAlertPatterns("sqlservr, java*")}
	assert.True(t, rule.matchesName("sqlservr.exe"))
	assert.True(t, rule.matchesName("javaw.exe"))
	assert.False(t, rule.matchesName("sqlwriter.exe"))
}

func TestProcessRuleValidation(t *testing.T) {
	valid := []stateAlertRule{
		{kind: stateAlertKindProcess, patterns: []string{"nginx"}, condition: stateAlertConditionIsNot, states: []string{"running"}},
		{kind: stateAlertKindProcess, patterns: []string{"java*"}, condition: stateAlertConditionAbove, metric: "mem", threshold: 20},
		{kind: stateAlertKindProcess, patterns: []string{"php-fpm"}, condition: stateAlertConditionBelow, metric: "count", threshold: 2},
	}
	for _, rule := range valid {
		assert.NoError(t, rule.validate(), rule)
	}
	invalid := []stateAlertRule{
		// a metric is only for the processes
		{kind: stateAlertKindService, patterns: []string{"x"}, condition: stateAlertConditionAbove, metric: "cpu", threshold: 10},
		// a percent above 100
		{kind: stateAlertKindProcess, patterns: []string{"x"}, condition: stateAlertConditionAbove, metric: "cpu", threshold: 150},
		// a metric without a threshold condition
		{kind: stateAlertKindProcess, patterns: []string{"x"}, condition: stateAlertConditionIs, metric: "mem", threshold: 10},
		// fewer than 0 instances
		{kind: stateAlertKindProcess, patterns: []string{"x"}, condition: stateAlertConditionBelow, metric: "count"},
		// a state of the services
		{kind: stateAlertKindProcess, patterns: []string{"x"}, condition: stateAlertConditionIs, states: []string{"active"}},
		// a threshold condition without a metric
		{kind: stateAlertKindProcess, patterns: []string{"x"}, condition: stateAlertConditionAbove, threshold: 10},
	}
	for _, rule := range invalid {
		assert.Error(t, rule.validate(), rule)
	}
}
