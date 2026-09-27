package alerts

import (
	"slices"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// removeRuleQuietHours removes a deleted state rule from the quiet hours of
// its system: from the windows limited to the rule, and the services,
// containers or processes the rule targeted and no other rule of the system
// targets. A window left without any scope is deleted, as it would silence
// all the alerts of the system.
func removeRuleQuietHours(app core.App, rule *core.Record) error {
	windows, err := app.FindAllRecords("quiet_hours", dbx.HashExp{
		"user":   rule.GetString("user"),
		"system": rule.GetString("system"),
	})
	if err != nil || len(windows) == 0 {
		return err
	}
	others, err := app.FindAllRecords(stateAlertsCollection, dbx.HashExp{"system": rule.GetString("system")})
	if err != nil {
		return err
	}
	deleted := stateAlertRuleFromRecord(rule)
	kind := rule.GetString("kind")
	// whether another rule of the system still targets a name
	stillTargeted := func(name string) bool {
		return slices.ContainsFunc(others, func(other *core.Record) bool {
			return other.Id != rule.Id && other.GetString("kind") == kind && stateAlertRuleFromRecord(other).matchesName(name)
		})
	}

	for _, window := range windows {
		var alerts []string
		var targets []quietTarget
		rules := window.GetStringSlice("rules")
		_ = window.UnmarshalJSONField("alerts", &alerts)
		_ = window.UnmarshalJSONField("targets", &targets)

		keptRules := slices.DeleteFunc(slices.Clone(rules), func(id string) bool { return id == rule.Id })
		keptTargets := slices.DeleteFunc(slices.Clone(targets), func(target quietTarget) bool {
			return target.Kind == kind && deleted.matchesName(target.Name) && !stillTargeted(target.Name)
		})
		if len(keptRules) == len(rules) && len(keptTargets) == len(targets) {
			continue
		}
		if len(keptRules) == 0 && len(keptTargets) == 0 && len(alerts) == 0 {
			if err := app.Delete(window); err != nil {
				return err
			}
			continue
		}
		window.Set("rules", keptRules)
		window.Set("targets", keptTargets)
		if err := app.Save(window); err != nil {
			return err
		}
	}
	return nil
}
