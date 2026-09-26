package migrations

import (
	"slices"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Adds the process state rules: a process that must run or must not run, or
// whose CPU, memory or number of instances goes above or below a threshold.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("state_alerts")
		if err != nil {
			return err
		}
		if kind, ok := collection.Fields.GetByName("kind").(*core.SelectField); ok && !slices.Contains(kind.Values, "process") {
			kind.Values = append(kind.Values, "process")
		}
		if condition, ok := collection.Fields.GetByName("condition").(*core.SelectField); ok {
			for _, value := range []string{"above", "below"} {
				if !slices.Contains(condition.Values, value) {
					condition.Values = append(condition.Values, value)
				}
			}
		}
		if collection.Fields.GetByName("metric") == nil {
			collection.Fields.Add(&core.SelectField{Name: "metric", Values: []string{"cpu", "mem", "count"}, MaxSelect: 1})
		}
		if collection.Fields.GetByName("threshold") == nil {
			collection.Fields.Add(&core.NumberField{Name: "threshold", Min: types.Pointer(0.0), Max: types.Pointer(100000.0)})
		}
		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("state_alerts")
		if err != nil {
			return err
		}
		if _, err := app.DB().NewQuery("DELETE FROM state_alerts WHERE kind = 'process' OR condition IN ('above', 'below')").Execute(); err != nil {
			return err
		}
		if kind, ok := collection.Fields.GetByName("kind").(*core.SelectField); ok {
			kind.Values = slices.DeleteFunc(kind.Values, func(v string) bool { return v == "process" })
		}
		if condition, ok := collection.Fields.GetByName("condition").(*core.SelectField); ok {
			condition.Values = slices.DeleteFunc(condition.Values, func(v string) bool { return v == "above" || v == "below" })
		}
		collection.Fields.RemoveByName("metric")
		collection.Fields.RemoveByName("threshold")
		return app.Save(collection)
	})
}
