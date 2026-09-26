package migrations

import (
	"slices"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds the weekly and monthly quiet hours: on some days of the week, on some
// days of the month (32 is the last one), or on some weekdays of some weeks
// of the month (the 2nd Tuesday, the last Friday: week 5 is the last one).
// The timezone of the user places the days and hours of the window.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("quiet_hours")
		if err != nil {
			return err
		}
		if field, ok := collection.Fields.GetByName("type").(*core.SelectField); ok {
			for _, value := range []string{"weekly", "monthly"} {
				if !slices.Contains(field.Values, value) {
					field.Values = append(field.Values, value)
				}
			}
		}
		if collection.Fields.GetByName("days") == nil {
			collection.Fields.Add(&core.JSONField{Name: "days", MaxSize: 2000})
		}
		if collection.Fields.GetByName("weeks") == nil {
			collection.Fields.Add(&core.JSONField{Name: "weeks", MaxSize: 200})
		}
		if collection.Fields.GetByName("timezone") == nil {
			collection.Fields.Add(&core.TextField{Name: "timezone", Max: 64})
		}
		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("quiet_hours")
		if err != nil {
			return err
		}
		if _, err := app.DB().NewQuery("DELETE FROM quiet_hours WHERE type IN ('weekly', 'monthly')").Execute(); err != nil {
			return err
		}
		if field, ok := collection.Fields.GetByName("type").(*core.SelectField); ok {
			field.Values = slices.DeleteFunc(field.Values, func(v string) bool { return v == "weekly" || v == "monthly" })
		}
		collection.Fields.RemoveByName("days")
		collection.Fields.RemoveByName("weeks")
		collection.Fields.RemoveByName("timezone")
		return app.Save(collection)
	})
}
