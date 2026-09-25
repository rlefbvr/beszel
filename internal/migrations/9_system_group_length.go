package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Limits the names of the system groups to 40 characters, to fit the tabs and
// dialogs showing them. Longer names are shortened.
func init() {
	m.Register(func(app core.App) error {
		if _, err := app.DB().NewQuery("UPDATE systems SET `group` = TRIM(SUBSTR(`group`, 1, 40)) WHERE LENGTH(`group`) > 40").Execute(); err != nil {
			return err
		}
		return setSystemGroupMax(app, 40)
	}, func(app core.App) error {
		return setSystemGroupMax(app, 60)
	})
}

func setSystemGroupMax(app core.App, max int) error {
	collection, err := app.FindCollectionByNameOrId("systems")
	if err != nil {
		return err
	}
	field, ok := collection.Fields.GetByName("group").(*core.TextField)
	if !ok {
		return nil
	}
	field.Max = max
	return app.Save(collection)
}
