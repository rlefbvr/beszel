//go:build testing

package agent

import (
	"testing"
	"time"

	"github.com/henrygd/beszel/internal/entities/system"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const windowsBootEventsXML = `<Events>
<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><Provider Name='User32'/><EventID Qualifiers='32768'>1074</EventID><TimeCreated SystemTime='2026-06-12T13:07:32.6770570Z'/></System><EventData><Data Name='param1'>C:\Windows\explorer.exe (HOST)</Data><Data Name='param3'>Other (Unplanned)</Data><Data Name='param6'></Data><Data Name='param7'>CORP\admin</Data></EventData></Event>
<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><Provider Name='Microsoft-Windows-Kernel-General'/><EventID>13</EventID><TimeCreated SystemTime='2026-06-12T13:07:59.5Z'/></System><EventData><Data Name='StopTime'>2026-06-12T13:07:59.4529503Z</Data></EventData></Event>
<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><Provider Name='Microsoft-Windows-Kernel-General'/><EventID>12</EventID><TimeCreated SystemTime='2026-06-12T13:08:40.1Z'/></System><EventData><Data Name='StartTime'>2026-06-12T13:08:39.5000000Z</Data></EventData></Event>
<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><Provider Name='User32'/><EventID>1074</EventID><TimeCreated SystemTime='2026-07-10T09:17:50Z'/></System><EventData><Data Name='param1'>wininit.exe</Data><Data Name='param3'>No title for this reason could be found</Data><Data Name='param6'>lsass.exe terminated unexpectedly.</Data><Data Name='param7'></Data></EventData></Event>
<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><Provider Name='Microsoft-Windows-Kernel-General'/><EventID>12</EventID><TimeCreated SystemTime='2026-09-15T07:03:16.1250474Z'/></System><EventData><Data Name='StartTime'>2026-09-15T07:03:15.5000000Z</Data></EventData></Event>
<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><Provider Name='EventLog'/><EventID Qualifiers='32768'>6008</EventID><TimeCreated SystemTime='2026-09-15T07:03:31.8134781Z'/></System><EventData><Data>17:33:30</Data><Binary>EA07090001000E00110021001E008702EA07090001000E000F0021001E008702DC0500003C000000</Binary></EventData></Event>
</Events>`

func TestParseWindowsBootEvents(t *testing.T) {
	events, err := parseWindowsBootEvents(windowsBootEventsXML)
	require.NoError(t, err)
	require.Len(t, events, 2)

	clean := events[0]
	assert.Equal(t, time.Date(2026, 6, 12, 13, 8, 39, 500000000, time.UTC), clean.Boot.UTC())
	assert.Equal(t, time.Date(2026, 6, 12, 13, 7, 59, 452950300, time.UTC), clean.Shutdown.UTC())
	assert.False(t, clean.Unexpected)
	assert.Equal(t, "Other (Unplanned)", clean.Reason, "without comment, the reason title")
	assert.Equal(t, `CORP\admin`, clean.User)

	crash := events[1]
	assert.True(t, crash.Unexpected, "6008 marks the boot after an unexpected shutdown")
	assert.Equal(t, time.Date(2026, 9, 14, 15, 33, 30, 647000000, time.UTC), crash.Shutdown, "the UTC SYSTEMTIME of the 6008 event")
	assert.Equal(t, "lsass.exe terminated unexpectedly.", crash.Reason, "the comment is preferred")
	assert.Equal(t, "wininit.exe", crash.User, "system requests show the process")
}

func TestWindowsBootEventsQuery(t *testing.T) {
	assert.NotContains(t, windowsBootEventsQuery(time.Time{}), "TimeCreated")
	query := windowsBootEventsQuery(time.Date(2026, 9, 2, 10, 0, 0, 0, time.UTC))
	assert.Contains(t, query, "TimeCreated[@SystemTime>='2026-09-01T10:00:00.000Z']", "reads one day before since")
}

func TestDecodeWindowsText(t *testing.T) {
	// "é" in UTF-16LE with a byte order mark
	assert.Equal(t, "é!", decodeWindowsText([]byte{0xff, 0xfe, 0xe9, 0x00, 0x21, 0x00}))
}

func TestParseJournalBoots(t *testing.T) {
	jsonOut := `[{"index":-1,"boot_id":"8c1b2f7a0e5d4c3b9a8f7e6d5c4b3a21","first_entry":1758520801000000,"last_entry":1758527910000000},` +
		`{"index":0,"boot_id":"1f2e3d4c5b6a79880a1b2c3d4e5f6a7b","first_entry":1758528001000000,"last_entry":1758531601000000}]`
	boots := parseJournalBoots([]byte(jsonOut))
	require.Len(t, boots, 2)
	assert.Equal(t, time.UnixMicro(1758520801000000).UTC(), boots[0].First)

	tableOut := "IDX BOOT ID                          FIRST ENTRY                 LAST ENTRY\n" +
		" -1 8c1b2f7a0e5d4c3b9a8f7e6d5c4b3a21 Mon 2026-09-22 06:00:01 UTC Mon 2026-09-22 07:58:30 UTC\n" +
		"  0 1f2e3d4c5b6a79880a1b2c3d4e5f6a7b Mon 2026-09-22 08:00:01 UTC Mon 2026-09-22 09:00:01 UTC\n"
	boots = parseJournalBoots([]byte(tableOut))
	require.Len(t, boots, 2)
	assert.Equal(t, time.Date(2026, 9, 22, 7, 58, 30, 0, time.UTC), boots[0].Last)

	events := journalBootEvents(boots, func(string) bool { return false })
	require.Len(t, events, 2)
	assert.True(t, events[0].Shutdown.IsZero(), "nothing is known before the first boot")
	assert.Equal(t, boots[0].Last, events[1].Shutdown)
	assert.True(t, events[1].Unexpected)
}

func TestIsCleanShutdownLog(t *testing.T) {
	assert.True(t, isCleanShutdownLog("Stopped target Basic System.\nReached target System Reboot.\nJournal stopped"))
	assert.False(t, isCleanShutdownLog("sshd[812]: Accepted publickey for root"))
}

func TestParseWtmpBootEvents(t *testing.T) {
	out := "reboot   system boot  6.8.0-45-generic 2026-09-22T10:00:01+02:00 - still running\n" +
		"reboot   system boot  6.8.0-45-generic 2026-09-21T08:00:01+02:00 - 2026-09-22T09:58:30+02:00 (1+01:58)\n" +
		"reboot   system boot  6.8.0-45-generic 2026-09-20T08:00:01+02:00 - crash (1+00:00)\n" +
		"\nwtmp begins Mon Sep  1 00:00:00 2026\n"
	events := parseWtmpBootEvents([]byte(out))
	require.Len(t, events, 3)
	assert.Equal(t, time.Date(2026, 9, 20, 6, 0, 1, 0, time.UTC), events[0].Boot)
	assert.True(t, events[1].Unexpected, "the previous run crashed")
	assert.Equal(t, time.Date(2026, 9, 22, 7, 58, 30, 0, time.UTC), events[2].Shutdown)
	assert.False(t, events[2].Unexpected)
}

func TestFinishBootEvents(t *testing.T) {
	base := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	var events []system.BootEvent
	for i := range maxBootEvents + 10 {
		events = append(events, system.BootEvent{Boot: base.Add(time.Duration(i) * time.Hour)})
	}
	res := finishBootEvents(system.BootSourceJournal, events, base.Add(2*time.Hour))
	assert.Equal(t, system.BootSourceJournal, res.Source)
	assert.Len(t, res.Events, maxBootEvents)
	assert.True(t, res.Events[0].Boot.Before(res.Events[1].Boot), "sorted by boot")
	assert.True(t, res.Events[0].Boot.After(base.Add(2*time.Hour)))
}
