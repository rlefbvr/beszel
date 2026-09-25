package agent

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"log/slog"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/fxamacker/cbor/v2"
	"github.com/henrygd/beszel/internal/common"
	"github.com/henrygd/beszel/internal/entities/system"
)

// maxBootEvents caps the boots returned to the hub, most recent first kept.
const maxBootEvents = 100

// bootEventsLookback also reads the logs shortly before the requested date, so
// the shutdown details of the first returned boot are known.
const bootEventsLookback = 24 * time.Hour

// GetBootEventsHandler returns the boots of the host found in its logs.
type GetBootEventsHandler struct{}

func (h *GetBootEventsHandler) Handle(hctx *HandlerContext) error {
	var req common.BootEventsRequest
	_ = cbor.Unmarshal(hctx.Request.Data, &req)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	response, err := readBootEvents(ctx, req.Since)
	if err != nil {
		slog.Debug("Boot events unavailable", "err", err)
	}
	return hctx.SendResponse(response, hctx.RequestID)
}

// finishBootEvents sorts boots, keeps those after since and caps their number.
func finishBootEvents(source string, events []system.BootEvent, since time.Time) system.BootEventsResponse {
	slices.SortFunc(events, func(a, b system.BootEvent) int { return a.Boot.Compare(b.Boot) })
	events = slices.DeleteFunc(events, func(e system.BootEvent) bool { return !e.Boot.After(since) })
	if len(events) > maxBootEvents {
		events = events[len(events)-maxBootEvents:]
	}
	return system.BootEventsResponse{Source: source, Events: events}
}

////////////////////////////////////////////////////////////////////////////
// Windows System event log (wevtutil)
////////////////////////////////////////////////////////////////////////////

// windowsBootEventsQuery selects in the System log the OS start (12) and stop
// (13) events, the shutdown requests (1074) and the unexpected shutdowns (6008).
func windowsBootEventsQuery(since time.Time) string {
	events := `(Provider[@Name='Microsoft-Windows-Kernel-General'] and (EventID=12 or EventID=13)) or ` +
		`(Provider[@Name='User32'] and EventID=1074) or ` +
		`(Provider[@Name='EventLog'] and EventID=6008)`
	if since.IsZero() {
		return "*[System[" + events + "]]"
	}
	from := since.Add(-bootEventsLookback).UTC().Format("2006-01-02T15:04:05.000Z")
	return "*[System[TimeCreated[@SystemTime>='" + from + "'] and (" + events + ")]]"
}

type windowsEvent struct {
	System struct {
		Provider struct {
			Name string `xml:"Name,attr"`
		} `xml:"Provider"`
		EventID     int `xml:"EventID"`
		TimeCreated struct {
			SystemTime time.Time `xml:"SystemTime,attr"`
		} `xml:"TimeCreated"`
	} `xml:"System"`
	EventData struct {
		Data []struct {
			Name  string `xml:"Name,attr"`
			Value string `xml:",chardata"`
		} `xml:"Data"`
		Binary string `xml:"Binary"`
	} `xml:"EventData"`
}

// data returns a named event value.
func (e windowsEvent) data(name string) string {
	for _, d := range e.EventData.Data {
		if d.Name == name {
			return strings.TrimSpace(d.Value)
		}
	}
	return ""
}

// dataTime returns a named event time, or the time the event was logged.
func (e windowsEvent) dataTime(name string) time.Time {
	if t, err := time.Parse(time.RFC3339Nano, e.data(name)); err == nil {
		return t
	}
	return e.System.TimeCreated.SystemTime
}

// decodeWindowsText decodes the UTF-16 output of wevtutil /uni:true.
func decodeWindowsText(out []byte) string {
	out = bytes.TrimPrefix(out, []byte{0xff, 0xfe})
	units := make([]uint16, len(out)/2)
	for i := range units {
		units[i] = binary.LittleEndian.Uint16(out[2*i:])
	}
	return string(utf16.Decode(units))
}

// parseWindowsBootEvents turns wevtutil XML output (/e:Events) into boots.
func parseWindowsBootEvents(xmlText string) ([]system.BootEvent, error) {
	var parsed struct {
		Events []windowsEvent `xml:"Event"`
	}
	if err := xml.Unmarshal([]byte(xmlText), &parsed); err != nil {
		return nil, err
	}
	events := parsed.Events
	slices.SortStableFunc(events, func(a, b windowsEvent) int {
		return a.System.TimeCreated.SystemTime.Compare(b.System.TimeCreated.SystemTime)
	})

	var boots []system.BootEvent
	// details of the run that ends with the next boot
	var run system.BootEvent
	for _, e := range events {
		switch e.System.EventID {
		case 1074: // shutdown or restart requested
			run.Reason, run.User = windowsShutdownRequest(e)
		case 13: // the OS is shutting down
			run.Shutdown = e.dataTime("StopTime")
		case 12: // the OS started
			run.Boot = e.dataTime("StartTime")
			boots = append(boots, run)
			run = system.BootEvent{}
		case 6008: // logged after a boot that follows an unexpected shutdown
			if n := len(boots); n > 0 {
				boots[n-1].Unexpected = true
				if t := windowsUnexpectedShutdownTime(e.EventData.Binary); !t.IsZero() {
					boots[n-1].Shutdown = t
				}
			}
		}
	}
	return boots, nil
}

// windowsShutdownRequest returns the reason and the requester of a 1074 event:
// the comment (or the reason title) and the user, or the process for system requests.
func windowsShutdownRequest(e windowsEvent) (reason, user string) {
	reason = e.data("param6")
	if reason == "" {
		reason = e.data("param3")
	}
	user = e.data("param7")
	if user == "" || strings.HasPrefix(strings.ToUpper(user), `NT AUTHORITY\`) {
		// "C:\Windows\System32\svchost.exe (HOST)" -> "svchost.exe"
		process, _, _ := strings.Cut(e.data("param1"), " (")
		if process != "" {
			user = filepath.Base(strings.ReplaceAll(process, `\`, "/"))
		}
	}
	return reason, user
}

// windowsUnexpectedShutdownTime reads the time of an unexpected shutdown from
// the binary data of a 6008 event: two SYSTEMTIME, local then UTC.
func windowsUnexpectedShutdownTime(binaryHex string) time.Time {
	b, err := hex.DecodeString(strings.TrimSpace(binaryHex))
	if err != nil || len(b) < 32 {
		return time.Time{}
	}
	st := b[16:32]
	field := func(i int) int { return int(binary.LittleEndian.Uint16(st[2*i:])) }
	// wYear, wMonth, wDayOfWeek, wDay, wHour, wMinute, wSecond, wMilliseconds
	if field(0) < 1990 || field(1) < 1 || field(1) > 12 {
		return time.Time{}
	}
	return time.Date(field(0), time.Month(field(1)), field(3), field(4), field(5), field(6), field(7)*int(time.Millisecond), time.UTC)
}

////////////////////////////////////////////////////////////////////////////
// systemd journal (journalctl --list-boots)
////////////////////////////////////////////////////////////////////////////

// journalBoot is a boot listed by journalctl, with its first and last entries.
type journalBoot struct {
	ID    string
	First time.Time
	Last  time.Time
}

var (
	journalBootIDRe   = regexp.MustCompile(`\b[0-9a-f]{32}\b`)
	journalUTCTimeRe  = regexp.MustCompile(`(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) UTC`)
	wtmpTimeRe        = regexp.MustCompile(`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}:?\d{2}|Z)`)
	cleanShutdownMsgs = []string{
		"Journal stopped",
		"Reached target System Reboot",
		"Reached target System Power Off",
		"Reached target System Halt",
		"Reached target Reboot",
		"Reached target Power-Off",
	}
)

// parseJournalBoots reads `journalctl --list-boots --utc`, as JSON (systemd
// 251+) or as the older table.
func parseJournalBoots(out []byte) []journalBoot {
	var boots []journalBoot
	if trimmed := bytes.TrimSpace(out); len(trimmed) > 0 && trimmed[0] == '[' {
		var entries []struct {
			ID    string `json:"boot_id"`
			First int64  `json:"first_entry"`
			Last  int64  `json:"last_entry"`
		}
		if json.Unmarshal(trimmed, &entries) == nil {
			for _, e := range entries {
				boots = append(boots, journalBoot{ID: e.ID, First: time.UnixMicro(e.First).UTC(), Last: time.UnixMicro(e.Last).UTC()})
			}
			return boots
		}
	}
	for line := range strings.SplitSeq(string(out), "\n") {
		id := journalBootIDRe.FindString(line)
		times := journalUTCTimeRe.FindAllStringSubmatch(line, 2)
		if id == "" || len(times) < 2 {
			continue
		}
		first, err1 := time.Parse(time.DateTime, times[0][1])
		last, err2 := time.Parse(time.DateTime, times[1][1])
		if err1 == nil && err2 == nil {
			boots = append(boots, journalBoot{ID: id, First: first, Last: last})
		}
	}
	return boots
}

// journalBootEvents turns journal boots into boot events: each boot follows
// the last entry of the previous one. cleanShutdown reports whether a boot
// ended with a clean shutdown.
func journalBootEvents(boots []journalBoot, cleanShutdown func(bootID string) bool) []system.BootEvent {
	slices.SortFunc(boots, func(a, b journalBoot) int { return a.First.Compare(b.First) })
	events := make([]system.BootEvent, 0, len(boots))
	for i, boot := range boots {
		event := system.BootEvent{Boot: boot.First}
		if i > 0 {
			previous := boots[i-1]
			event.Shutdown = previous.Last
			event.Unexpected = !cleanShutdown(previous.ID)
		}
		events = append(events, event)
	}
	return events
}

// isCleanShutdownLog reports whether the last messages of a boot show a clean shutdown.
func isCleanShutdownLog(lastMessages string) bool {
	for _, msg := range cleanShutdownMsgs {
		if strings.Contains(lastMessages, msg) {
			return true
		}
	}
	return false
}

////////////////////////////////////////////////////////////////////////////
// login records (last -x --time-format iso reboot)
////////////////////////////////////////////////////////////////////////////

// parseWtmpBootEvents reads the reboot entries of `last`: each entry starts a
// boot and ends at the next shutdown, or with "crash".
func parseWtmpBootEvents(out []byte) []system.BootEvent {
	type run struct {
		boot, end time.Time
		crashed   bool
	}
	var runs []run
	for line := range strings.SplitSeq(string(out), "\n") {
		if !strings.HasPrefix(line, "reboot") {
			continue
		}
		times := wtmpTimeRe.FindAllString(line, 2)
		if len(times) == 0 {
			continue
		}
		boot, err := parseWtmpTime(times[0])
		if err != nil {
			continue
		}
		r := run{boot: boot, crashed: strings.Contains(line, "crash")}
		if len(times) > 1 {
			r.end, _ = parseWtmpTime(times[1])
		}
		runs = append(runs, r)
	}
	slices.SortFunc(runs, func(a, b run) int { return a.boot.Compare(b.boot) })
	events := make([]system.BootEvent, 0, len(runs))
	for i, r := range runs {
		event := system.BootEvent{Boot: r.boot}
		if i > 0 {
			event.Shutdown = runs[i-1].end
			event.Unexpected = runs[i-1].crashed
		}
		events = append(events, event)
	}
	return events
}

func parseWtmpTime(value string) (time.Time, error) {
	for _, layout := range []string{"2006-01-02T15:04:05-07:00", "2006-01-02T15:04:05-0700", time.RFC3339} {
		if t, err := time.Parse(layout, value); err == nil {
			return t.UTC(), nil
		}
	}
	return time.Parse(time.RFC3339, value)
}
