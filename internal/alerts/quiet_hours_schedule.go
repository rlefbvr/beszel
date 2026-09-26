package alerts

import (
	"slices"
	"time"
	// the timezones of the users, also where the system has no zoneinfo (Windows, containers)
	_ "time/tzdata"

	"github.com/pocketbase/pocketbase/core"
)

const (
	// lastDayOfMonth in the days of a monthly window is the last day of each month
	lastDayOfMonth = 32
	// lastWeekOfMonth in the weeks of a monthly window is the last week of each month
	lastWeekOfMonth = 5
)

// quietWindowActive tells whether a quiet hours window silences the alerts at a time.
func quietWindowActive(window *core.Record, now time.Time) bool {
	start := window.GetDateTime("start").Time()
	end := window.GetDateTime("end").Time()
	windowType := window.GetString("type")
	if windowType == "one-time" || windowType == "" {
		return !now.Before(start) && now.Before(end)
	}

	// Recurring windows: the hours are the local hours of the user who set the
	// window up, and so are the days. Windows saved before the timezone was
	// stored are daily windows, compared in UTC.
	location := time.UTC
	if name := window.GetString("timezone"); name != "" {
		if loc, err := time.LoadLocation(name); err == nil {
			location = loc
		}
	}
	local := now.In(location)
	startMinutes := minutesOfDay(start.In(location))
	endMinutes := minutesOfDay(end.In(location))
	nowMinutes := minutesOfDay(local)

	// the day the current occurrence started, for the windows crossing midnight
	var day time.Time
	switch {
	case startMinutes < endMinutes:
		if nowMinutes < startMinutes || nowMinutes >= endMinutes {
			return false
		}
		day = local
	case startMinutes > endMinutes:
		if nowMinutes >= startMinutes {
			day = local
		} else if nowMinutes < endMinutes {
			day = local.AddDate(0, 0, -1)
		} else {
			return false
		}
	default:
		return false
	}

	var days, weeks []int
	_ = window.UnmarshalJSONField("days", &days)
	_ = window.UnmarshalJSONField("weeks", &weeks)
	return quietDayMatches(windowType, days, weeks, day)
}

// quietDayMatches tells whether a recurring window runs on a day.
func quietDayMatches(windowType string, days, weeks []int, day time.Time) bool {
	switch windowType {
	case "weekly":
		return slices.Contains(days, isoWeekday(day))
	case "monthly":
		dayOfMonth := day.Day()
		daysInMonth := time.Date(day.Year(), day.Month()+1, 0, 0, 0, 0, 0, day.Location()).Day()
		if len(weeks) == 0 {
			return slices.Contains(days, dayOfMonth) || (slices.Contains(days, lastDayOfMonth) && dayOfMonth == daysInMonth)
		}
		if !slices.Contains(days, isoWeekday(day)) {
			return false
		}
		week := (dayOfMonth-1)/7 + 1
		return slices.Contains(weeks, week) || (slices.Contains(weeks, lastWeekOfMonth) && dayOfMonth+7 > daysInMonth)
	}
	// daily
	return true
}

// isoWeekday numbers the days from Monday (1) to Sunday (7).
func isoWeekday(day time.Time) int {
	if day.Weekday() == time.Sunday {
		return 7
	}
	return int(day.Weekday())
}

func minutesOfDay(t time.Time) int {
	hour, minute, _ := t.Clock()
	return hour*60 + minute
}
