package alerts

import (
	"fmt"
	"path"
	"slices"
	"strings"
	"time"

	"github.com/henrygd/beszel/internal/entities/container"
	"github.com/henrygd/beszel/internal/entities/system"
	"github.com/henrygd/beszel/internal/entities/systemd"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const (
	stateAlertsCollection = "state_alerts"

	// Names stored in alerts_history for state rule incidents.
	alertNameServiceState   = "ServiceState"
	alertNameContainerState = "ContainerState"

	stateAlertKindService   = "service"
	stateAlertKindContainer = "container"

	stateAlertConditionIs    = "is"
	stateAlertConditionIsNot = "is_not"

	// serviceStateAbsent is the state of a service the agent no longer reports
	// (stopped and filtered out by the agent, or removed).
	serviceStateAbsent = "absent"
	// containerStateStopped covers containers missing from the agent report:
	// the agent only lists running containers.
	containerStateStopped = "stopped"
)

var (
	serviceStates       = []string{"active", "inactive", "failed", "activating", "deactivating", "reloading"}
	serviceSubStates    = []string{"dead", "running", "exited", "failed", "unknown"}
	containerStates     = []string{"running", "paused", "restarting", containerStateStopped}
	containerHealthKeys = []string{"none", "starting", "healthy", "unhealthy"}
)

// stateAlertTarget tracks one service or container matched by a rule.
type stateAlertTarget struct {
	// Count is the number of consecutive observations matching the condition.
	Count int `json:"c,omitempty"`
	// History is the open alerts_history record while the target is triggered.
	History string `json:"h,omitempty"`
}

// stateAlertState is stored in the rule's state field.
type stateAlertState struct {
	// Snapshot is the last evaluated systemd_services update (unix ms), so a
	// service snapshot is only counted once however often the system updates.
	Snapshot int64 `json:"s,omitempty"`
	// Targets are the services or containers seen by the rule, by name.
	Targets map[string]*stateAlertTarget `json:"t,omitempty"`
}

// observedState is the state of a service or container in the latest report.
type observedState struct {
	state string
	sub   string
}

// stateAlertRule is the configuration of a state_alerts record.
type stateAlertRule struct {
	kind      string
	patterns  []string
	condition string
	states    []string
	subStates []string
	cycles    int
}

func stateAlertRuleFromRecord(record *core.Record) stateAlertRule {
	rule := stateAlertRule{
		kind:      record.GetString("kind"),
		patterns:  parseStateAlertPatterns(record.GetString("targets")),
		condition: record.GetString("condition"),
		cycles:    max(1, record.GetInt("cycles")),
	}
	_ = record.UnmarshalJSONField("states", &rule.states)
	_ = record.UnmarshalJSONField("sub_states", &rule.subStates)
	return rule
}

func parseStateAlertPatterns(targets string) []string {
	var patterns []string
	for _, p := range strings.Split(targets, ",") {
		if p = strings.ToLower(strings.TrimSpace(p)); p != "" {
			patterns = append(patterns, p)
		}
	}
	return patterns
}

func isLiteralPattern(pattern string) bool {
	return !strings.ContainsAny(pattern, "*?[")
}

// stateAlertNameCandidates returns the names a pattern is matched against: the
// full name, the systemd unit without ".service", and the Windows short service
// name shown in parentheses ("Print Spooler (Spooler)").
func stateAlertNameCandidates(name string) []string {
	lower := strings.ToLower(name)
	candidates := []string{lower}
	if trimmed, ok := strings.CutSuffix(lower, ".service"); ok {
		candidates = append(candidates, trimmed)
	}
	if strings.HasSuffix(lower, ")") {
		if i := strings.LastIndex(lower, " ("); i > 0 {
			candidates = append(candidates, lower[i+2:len(lower)-1], lower[:i])
		}
	}
	return candidates
}

func (r stateAlertRule) matchesName(name string) bool {
	candidates := stateAlertNameCandidates(name)
	for _, pattern := range r.patterns {
		for _, candidate := range candidates {
			if ok, _ := path.Match(pattern, candidate); ok {
				return true
			}
		}
	}
	return false
}

// fires reports whether an observed state should trigger the rule.
func (r stateAlertRule) fires(obs observedState) bool {
	matches := (len(r.states) == 0 || slices.Contains(r.states, obs.state)) &&
		(len(r.subStates) == 0 || slices.Contains(r.subStates, obs.sub))
	if r.condition == stateAlertConditionIsNot {
		return !matches
	}
	return matches
}

// validateStateAlertRule checks rule values that the collection schema can't express.
func validateStateAlertRule(record *core.Record) error {
	rule := stateAlertRuleFromRecord(record)
	if len(rule.patterns) == 0 {
		return fmt.Errorf("at least one target is required")
	}
	allowedStates, allowedSubStates := serviceStates, serviceSubStates
	if rule.kind == stateAlertKindContainer {
		allowedStates, allowedSubStates = containerStates, containerHealthKeys
	}
	if len(rule.states) == 0 && len(rule.subStates) == 0 {
		return fmt.Errorf("select at least one state")
	}
	for _, s := range rule.states {
		if !slices.Contains(allowedStates, s) {
			return fmt.Errorf("invalid state %q", s)
		}
	}
	for _, s := range rule.subStates {
		if !slices.Contains(allowedSubStates, s) {
			return fmt.Errorf("invalid sub-state %q", s)
		}
	}
	return nil
}

// bindStateAlertEvents validates rules and keeps hub-managed fields out of client control.
func (am *AlertManager) bindStateAlertEvents() {
	am.hub.OnRecordCreateRequest(stateAlertsCollection).BindFunc(func(e *core.RecordRequestEvent) error {
		if !e.HasSuperuserAuth() && (e.Auth == nil || !userHasSystem(e.App, e.Auth.Id, e.Record.GetString("system"))) {
			return e.ForbiddenError("You do not have access to this system", nil)
		}
		if err := validateStateAlertRule(e.Record); err != nil {
			return e.BadRequestError(err.Error(), nil)
		}
		e.Record.Set("state", stateAlertState{})
		e.Record.Set("triggered", false)
		return e.Next()
	})
	am.hub.OnRecordUpdateRequest(stateAlertsCollection).BindFunc(func(e *core.RecordRequestEvent) error {
		original := e.Record.Original()
		if e.Record.GetString("system") != original.GetString("system") {
			return e.BadRequestError("Delete and recreate the rule to change its system", nil)
		}
		if err := validateStateAlertRule(e.Record); err != nil {
			return e.BadRequestError(err.Error(), nil)
		}
		// A changed rule starts over: open incidents are resolved below.
		changed := false
		for _, field := range []string{"kind", "targets", "condition", "states", "sub_states", "cycles"} {
			if fmt.Sprint(e.Record.Get(field)) != fmt.Sprint(original.Get(field)) {
				changed = true
				break
			}
		}
		if changed {
			e.Record.Set("state", stateAlertState{})
			e.Record.Set("triggered", false)
		} else {
			e.Record.Set("state", original.Get("state"))
			e.Record.Set("triggered", original.GetBool("triggered"))
		}
		if err := e.Next(); err != nil {
			return err
		}
		if changed {
			return resolveNetworkMonitorHistory(e.App, e.Record.Id)
		}
		return nil
	})
	am.hub.OnRecordAfterDeleteSuccess(stateAlertsCollection).BindFunc(func(e *core.RecordEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		return resolveNetworkMonitorHistory(e.App, e.Record.Id)
	})
}

// HandleStateAlerts evaluates state rules for a system after a successful update.
// Services are read from the latest systemd_services snapshot; containers from the
// update payload, where nil means Docker data is unavailable.
func (am *AlertManager) HandleStateAlerts(systemRecord *core.Record, data *system.CombinedData) error {
	if systemRecord.GetString("status") != "up" {
		return nil
	}
	rules, err := am.hub.FindAllRecords(stateAlertsCollection, dbx.HashExp{"system": systemRecord.Id})
	if err != nil || len(rules) == 0 {
		return err
	}
	hasKind := func(kind string) bool {
		return slices.ContainsFunc(rules, func(r *core.Record) bool { return r.GetString("kind") == kind })
	}
	if hasKind(stateAlertKindService) {
		services, snapshot, err := am.queryServiceSnapshot(systemRecord.Id)
		if err != nil {
			return err
		}
		if snapshot > 0 {
			if err := am.evaluateStateAlerts(systemRecord, stateAlertKindService, services, snapshot); err != nil {
				return err
			}
		}
	}
	if hasKind(stateAlertKindContainer) && data != nil && data.Containers != nil {
		if err := am.evaluateStateAlerts(systemRecord, stateAlertKindContainer, observeContainers(data.Containers), 0); err != nil {
			return err
		}
	}
	return nil
}

// queryServiceSnapshot returns the services of the latest update and its timestamp.
func (am *AlertManager) queryServiceSnapshot(systemID string) (map[string]observedState, int64, error) {
	var rows []struct {
		Name    string                  `db:"name"`
		State   systemd.ServiceState    `db:"state"`
		Sub     systemd.ServiceSubState `db:"sub"`
		Updated int64                   `db:"updated"`
	}
	err := am.hub.DB().
		Select("name", "state", "sub", "updated").
		From("systemd_services").
		Where(dbx.NewExp(
			"system={:system} AND updated=(SELECT MAX(updated) FROM systemd_services WHERE system={:system})",
			dbx.Params{"system": systemID},
		)).
		All(&rows)
	if err != nil || len(rows) == 0 {
		return nil, 0, err
	}
	services := make(map[string]observedState, len(rows))
	for _, row := range rows {
		services[row.Name] = observedState{
			state: enumLabel(serviceStates, int(row.State)),
			sub:   enumLabel(serviceSubStates, int(row.Sub)),
		}
	}
	return services, rows[0].Updated, nil
}

func enumLabel(labels []string, i int) string {
	if i >= 0 && i < len(labels) {
		return labels[i]
	}
	return "unknown"
}

func observeContainers(containers []*container.Stats) map[string]observedState {
	observed := make(map[string]observedState, len(containers))
	for _, c := range containers {
		if c == nil {
			continue
		}
		observed[c.Name] = observedState{
			state: containerStateFromStatus(c.Status),
			sub:   enumLabel(containerHealthKeys, int(c.Health)),
		}
	}
	return observed
}

// containerStateFromStatus maps Docker's status text ("Up 2 hours (Paused)",
// "Restarting (1) 5 seconds ago") to a rule state.
func containerStateFromStatus(status string) string {
	lower := strings.ToLower(status)
	switch {
	case strings.Contains(lower, "(paused)"):
		return "paused"
	case strings.HasPrefix(lower, "restarting"):
		return "restarting"
	case strings.HasPrefix(lower, "up"), lower == "":
		return "running"
	}
	return containerStateStopped
}

// stateAlertTargetNames lists what a rule evaluates: reported names matching its
// patterns, targets it has seen before, and literal patterns matching nothing.
func stateAlertTargetNames(rule stateAlertRule, observed map[string]observedState, known map[string]*stateAlertTarget) []string {
	names := map[string]struct{}{}
	for name := range observed {
		if rule.matchesName(name) {
			names[name] = struct{}{}
		}
	}
	for name := range known {
		names[name] = struct{}{}
	}
	for _, pattern := range rule.patterns {
		if !isLiteralPattern(pattern) {
			continue
		}
		found := false
		for name := range names {
			if slices.Contains(stateAlertNameCandidates(name), pattern) {
				found = true
				break
			}
		}
		if !found {
			names[pattern] = struct{}{}
		}
	}
	sorted := make([]string, 0, len(names))
	for name := range names {
		sorted = append(sorted, name)
	}
	slices.Sort(sorted)
	return sorted
}

func (am *AlertManager) evaluateStateAlerts(systemRecord *core.Record, kind string, observed map[string]observedState, snapshot int64) error {
	var messages []AlertMessageData
	systemID := systemRecord.Id
	systemName := systemRecord.GetString("name")
	historyName, targetLabel, absentState := alertNameServiceState, "Service", serviceStateAbsent
	if kind == stateAlertKindContainer {
		historyName, targetLabel, absentState = alertNameContainerState, "Container", containerStateStopped
	}

	err := am.hub.RunInTransaction(func(tx core.App) error {
		// Read rules inside the transaction so concurrent edits can't be overwritten.
		rules, err := tx.FindAllRecords(stateAlertsCollection, dbx.HashExp{"system": systemID, "kind": kind})
		if err != nil {
			return err
		}
		now := time.Now().UTC()
		for _, record := range rules {
			var state stateAlertState
			if err := record.UnmarshalJSONField("state", &state); err != nil {
				return err
			}
			if snapshot > 0 {
				if state.Snapshot == snapshot {
					continue
				}
				state.Snapshot = snapshot
			}
			if state.Targets == nil {
				state.Targets = map[string]*stateAlertTarget{}
			}
			rule := stateAlertRuleFromRecord(record)

			for _, name := range stateAlertTargetNames(rule, observed, state.Targets) {
				obs, present := observed[name]
				if !present {
					obs = observedState{state: absentState}
				}
				target := state.Targets[name]
				if target == nil {
					target = &stateAlertTarget{}
					state.Targets[name] = target
				}
				if rule.fires(obs) {
					target.Count++
				} else {
					target.Count = 0
				}

				switch {
				case target.History == "" && target.Count >= rule.cycles:
					collection, err := tx.FindCachedCollectionByNameOrId("alerts_history")
					if err != nil {
						return err
					}
					history := core.NewRecord(collection)
					history.Load(map[string]any{
						"alert_id": record.Id, "user": record.GetString("user"), "system": systemID,
						"name": historyName, "monitor_name": name, "value": 0,
					})
					if err := tx.Save(history); err != nil {
						return err
					}
					target.History = history.Id
					messages = append(messages, stateAlertMessage(record, targetLabel, name, systemName, obs, true))
				case target.History != "" && target.Count == 0:
					if err := resolveMonitorIncident(tx, target.History, now); err != nil {
						return err
					}
					target.History = ""
					messages = append(messages, stateAlertMessage(record, targetLabel, name, systemName, obs, false))
				}

				// Forget targets that are gone and quiet, unless named explicitly.
				if !present && target.History == "" && target.Count == 0 && !slices.Contains(rule.patterns, name) {
					delete(state.Targets, name)
				}
			}

			triggered := false
			for _, target := range state.Targets {
				triggered = triggered || target.History != ""
			}
			record.Set("state", state)
			record.Set("triggered", triggered)
			if err := tx.Save(record); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	// Persist transitions before delivery, like other alert types.
	for _, message := range messages {
		message.Link = am.hub.MakeLink("system", systemID)
		message.LinkText = "View " + systemName
		if err := am.SendAlert(message); err != nil {
			am.hub.Logger().Error("Failed to send state alert", "err", err)
		}
	}
	return nil
}

func formatObservedState(obs observedState) string {
	if obs.sub == "" || obs.sub == "none" {
		return obs.state
	}
	return fmt.Sprintf("%s (%s)", obs.state, obs.sub)
}

func formatStateAlertCondition(record *core.Record) string {
	rule := stateAlertRuleFromRecord(record)
	verb := "is"
	if rule.condition == stateAlertConditionIsNot {
		verb = "is not"
	}
	var parts []string
	if len(rule.states) > 0 {
		parts = append(parts, strings.Join(rule.states, " or "))
	}
	if len(rule.subStates) > 0 {
		parts = append(parts, "("+strings.Join(rule.subStates, " or ")+")")
	}
	return fmt.Sprintf("state %s %s", verb, strings.Join(parts, " "))
}

func stateAlertMessage(record *core.Record, targetLabel, name, systemName string, obs observedState, triggered bool) AlertMessageData {
	systemID := record.GetString("system")
	current := formatObservedState(obs)
	var title, message string
	if triggered {
		title = fmt.Sprintf("%s %s on %s: %s %v", targetLabel, name, systemName, current, "\U0001F534")
		message = fmt.Sprintf("%s %s on %s is %s. Rule: %s.", targetLabel, name, systemName, current, formatStateAlertCondition(record))
	} else {
		title = fmt.Sprintf("%s %s on %s recovered %v", targetLabel, name, systemName, "✅")
		message = fmt.Sprintf("%s %s on %s is now %s.", targetLabel, name, systemName, current)
	}
	return AlertMessageData{
		UserID:   record.GetString("user"),
		SystemID: systemID,
		Title:    title,
		Message:  message,
	}
}
