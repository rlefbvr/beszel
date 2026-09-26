//go:build testing

package alerts

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
	"github.com/stretchr/testify/assert"
)

// quietWindow builds a window with the hours of start and end in Paris.
func quietWindow(t *testing.T, windowType, startClock, endClock string, days, weeks []int) *core.Record {
	t.Helper()
	collection := core.NewBaseCollection("quiet_hours")
	collection.Fields.Add(
		&core.TextField{Name: "type"},
		&core.DateField{Name: "start"},
		&core.DateField{Name: "end"},
		&core.JSONField{Name: "days"},
		&core.JSONField{Name: "weeks"},
		&core.TextField{Name: "timezone"},
	)
	paris, _ := time.LoadLocation("Europe/Paris")
	parse := func(clock string) types.DateTime {
		local, err := time.ParseInLocation("2006-01-02 15:04", "2026-09-26 "+clock, paris)
		assert.NoError(t, err)
		value, _ := types.ParseDateTime(local.UTC())
		return value
	}
	record := core.NewRecord(collection)
	record.Set("type", windowType)
	record.Set("start", parse(startClock))
	record.Set("end", parse(endClock))
	record.Set("days", days)
	record.Set("weeks", weeks)
	record.Set("timezone", "Europe/Paris")
	return record
}

func parisTime(t *testing.T, value string) time.Time {
	t.Helper()
	paris, _ := time.LoadLocation("Europe/Paris")
	local, err := time.ParseInLocation("2006-01-02 15:04", value, paris)
	assert.NoError(t, err)
	return local.UTC()
}

func TestQuietWindowWeekly(t *testing.T) {
	// Mondays and Wednesdays from 22:00 to 06:00, Paris time
	window := quietWindow(t, "weekly", "22:00", "06:00", []int{1, 3}, nil)
	cases := map[string]bool{
		"2026-09-28 22:30": true,  // Monday evening
		"2026-09-29 05:59": true,  // the night of Monday continues on Tuesday
		"2026-09-29 06:00": false, // over
		"2026-09-29 22:30": false, // Tuesday evening
		"2026-09-30 23:00": true,  // Wednesday
		"2026-10-01 01:00": true,  // the night of Wednesday
		"2026-10-02 01:00": false, // the night of Thursday
		"2026-09-28 21:59": false, // before
	}
	for at, want := range cases {
		assert.Equal(t, want, quietWindowActive(window, parisTime(t, at)), at)
	}
}

func TestQuietWindowMonthlyDays(t *testing.T) {
	// the 1st, the 15th and the last day of the month, from 08:00 to 10:00
	window := quietWindow(t, "monthly", "08:00", "10:00", []int{1, 15, lastDayOfMonth}, nil)
	cases := map[string]bool{
		"2026-10-01 09:00": true,
		"2026-10-15 08:00": true,
		"2026-10-31 09:59": true,  // last day of October
		"2026-09-30 09:00": true,  // last day of September
		"2026-10-30 09:00": false, // not the last one
		"2026-10-15 10:00": false,
		"2026-02-28 09:00": true, // last day of February
	}
	for at, want := range cases {
		assert.Equal(t, want, quietWindowActive(window, parisTime(t, at)), at)
	}
}

func TestQuietWindowMonthlyWeekdays(t *testing.T) {
	// the 2nd Tuesday and the last Friday of the month, all day long but a minute
	window := quietWindow(t, "monthly", "00:00", "23:59", []int{2, 5}, nil)
	window.Set("weeks", []int{2, lastWeekOfMonth})
	cases := map[string]bool{
		"2026-10-13 12:00": true,  // 2nd Tuesday of October 2026
		"2026-10-06 12:00": false, // 1st Tuesday
		"2026-10-30 12:00": true,  // last Friday
		"2026-10-23 12:00": false, // 4th Friday, not the last
		"2026-10-09 12:00": true,  // 2nd Friday: the weeks apply to both days
	}
	for at, want := range cases {
		assert.Equal(t, want, quietWindowActive(window, parisTime(t, at)), at)
	}
}

func TestQuietWindowDailyLegacyUTC(t *testing.T) {
	// daily windows saved without a timezone keep their UTC hours
	window := quietWindow(t, "daily", "22:00", "23:00", nil, nil)
	window.Set("timezone", "")
	utc := func(value string) time.Time {
		at, _ := time.Parse("2006-01-02 15:04", value)
		return at
	}
	// 22:00 in Paris in September is 20:00 UTC
	assert.True(t, quietWindowActive(window, utc("2026-12-01 20:30")))
	assert.False(t, quietWindowActive(window, utc("2026-12-01 21:30")))

	// with the timezone, the hours stay the ones of Paris in winter too
	window.Set("timezone", "Europe/Paris")
	assert.True(t, quietWindowActive(window, utc("2026-12-01 21:30")))
}

func TestQuietWindowOneTime(t *testing.T) {
	window := quietWindow(t, "one-time", "10:00", "12:00", nil, nil)
	assert.True(t, quietWindowActive(window, parisTime(t, "2026-09-26 11:00")))
	assert.False(t, quietWindowActive(window, parisTime(t, "2026-09-27 11:00")))
}
