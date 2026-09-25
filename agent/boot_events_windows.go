//go:build windows

package agent

import (
	"context"
	"os/exec"
	"time"

	"github.com/henrygd/beszel/internal/entities/system"
)

// readBootEvents reads the boots from the System event log. /uni:true outputs
// UTF-16, which keeps localized reasons readable whatever the system code page.
func readBootEvents(ctx context.Context, since time.Time) (system.BootEventsResponse, error) {
	out, err := exec.CommandContext(ctx, "wevtutil", "qe", "System",
		"/q:"+windowsBootEventsQuery(since), "/f:xml", "/e:Events", "/uni:true").Output()
	if err != nil {
		return system.BootEventsResponse{}, err
	}
	events, err := parseWindowsBootEvents(decodeWindowsText(out))
	if err != nil {
		return system.BootEventsResponse{}, err
	}
	return finishBootEvents(system.BootSourceEventLog, events, since), nil
}
