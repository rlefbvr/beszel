//go:build linux

package agent

import (
	"context"
	"errors"
	"os/exec"
	"time"

	"github.com/henrygd/beszel/internal/entities/system"
)

// readBootEvents reads the boots from the systemd journal, or from the login
// records when the journal is not persistent or not readable.
func readBootEvents(ctx context.Context, since time.Time) (system.BootEventsResponse, error) {
	if events := readJournalBootEvents(ctx, since); len(events) > 0 {
		return finishBootEvents(system.BootSourceJournal, events, since), nil
	}
	out, err := exec.CommandContext(ctx, "last", "-x", "--time-format", "iso", "reboot").Output()
	if err != nil {
		return system.BootEventsResponse{}, err
	}
	events := parseWtmpBootEvents(out)
	if len(events) == 0 {
		return system.BootEventsResponse{}, errors.New("no boot found in the journal or login records")
	}
	return finishBootEvents(system.BootSourceWtmp, events, since), nil
}

// readJournalBootEvents lists the journal boots. The beszel user needs the
// systemd-journal group to see the system journal.
func readJournalBootEvents(ctx context.Context, since time.Time) []system.BootEvent {
	out, err := exec.CommandContext(ctx, "journalctl", "--list-boots", "--utc", "--no-pager", "-o", "json").Output()
	if err != nil {
		return nil
	}
	boots := parseJournalBoots(out)
	// only check how the boots of the requested period ended
	from := since.Add(-bootEventsLookback)
	return journalBootEvents(boots, func(bootID string) bool {
		for _, boot := range boots {
			if boot.ID == bootID && boot.Last.Before(from) {
				return true
			}
		}
		msgs, err := exec.CommandContext(ctx, "journalctl", "-b", bootID, "-n", "30", "-o", "cat", "--no-pager", "-q").Output()
		return err == nil && isCleanShutdownLog(string(msgs))
	})
}
