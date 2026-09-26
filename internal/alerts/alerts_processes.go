package alerts

import (
	"github.com/henrygd/beszel/internal/entities/system"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// HasProcessAlerts tells whether a system has process rules, so that its
// processes are only read from the agent when a rule needs them.
func (am *AlertManager) HasProcessAlerts(systemID string) bool {
	var count int
	err := am.hub.DB().
		Select("COUNT(*)").
		From(stateAlertsCollection).
		Where(dbx.HashExp{"system": systemID, "kind": stateAlertKindProcess}).
		Row(&count)
	return err == nil && count > 0
}

// HandleProcessAlerts evaluates the process rules of a system with the
// processes read from its agent. All the instances of a program count as one
// target: their CPU and memory add up.
func (am *AlertManager) HandleProcessAlerts(systemRecord *core.Record, processes []system.Process) error {
	if systemRecord.GetString("status") != "up" {
		return nil
	}
	return am.evaluateStateAlerts(systemRecord, stateAlertKindProcess, observeProcesses(processes), 0)
}

func observeProcesses(processes []system.Process) map[string]observedState {
	observed := make(map[string]observedState, len(processes))
	for _, p := range processes {
		if p.Name == "" {
			continue
		}
		obs := observed[p.Name]
		obs.state = "running"
		obs.cpu += p.CPU
		obs.mem += p.Memory
		obs.count++
		observed[p.Name] = obs
	}
	return observed
}
