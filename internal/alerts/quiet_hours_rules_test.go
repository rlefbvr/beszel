//go:build testing

package alerts_test

import (
	"testing"

	beszelTests "github.com/henrygd/beszel/internal/tests"
	"github.com/pocketbase/dbx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestQuietHoursRemovedWithTheirRule(t *testing.T) {
	hub, system, rule := stateAlertSetup(t, map[string]any{
		"kind": "process", "targets": "nginx", "states": []string{"running"},
	})
	other, err := beszelTests.CreateRecord(hub, "state_alerts", map[string]any{
		"user": rule.GetString("user"), "system": system.Id, "kind": "process", "targets": "java",
		"condition": "is_not", "states": []string{"running"}, "cycles": 1,
	})
	require.NoError(t, err)
	window := func(fields map[string]any) string {
		base := map[string]any{
			"user": rule.GetString("user"), "system": system.Id, "type": "daily",
			"start": "2026-09-27 20:00:00.000Z", "end": "2026-09-27 21:00:00.000Z",
		}
		for k, v := range fields {
			base[k] = v
		}
		record, err := beszelTests.CreateRecord(hub, "quiet_hours", base)
		require.NoError(t, err)
		return record.Id
	}
	// only for the deleted rule: deleted with it
	onlyRule := window(map[string]any{"rules": []string{rule.Id}})
	// for two rules: keeps the other one
	twoRules := window(map[string]any{"rules": []string{rule.Id, other.Id}})
	// set from the selection of the processes: the target of the rule goes
	onlyTarget := window(map[string]any{"targets": []map[string]string{{"kind": "process", "name": "nginx"}}})
	bothTargets := window(map[string]any{"targets": []map[string]string{
		{"kind": "process", "name": "nginx"}, {"kind": "process", "name": "java"},
	}})
	// the whole system: untouched
	wholeSystem := window(nil)

	require.NoError(t, hub.Delete(rule))

	exists := func(id string) bool {
		count, err := hub.CountRecords("quiet_hours", dbx.HashExp{"id": id})
		require.NoError(t, err)
		return count > 0
	}
	assert.False(t, exists(onlyRule))
	assert.False(t, exists(onlyTarget))
	assert.True(t, exists(wholeSystem))

	kept, err := hub.FindRecordById("quiet_hours", twoRules)
	require.NoError(t, err)
	assert.Equal(t, []string{other.Id}, kept.GetStringSlice("rules"))

	kept, err = hub.FindRecordById("quiet_hours", bothTargets)
	require.NoError(t, err)
	var targets []map[string]string
	require.NoError(t, kept.UnmarshalJSONField("targets", &targets))
	assert.Equal(t, []map[string]string{{"kind": "process", "name": "java"}}, targets)
}
