//go:build !windows && !linux

package agent

import (
	"context"
	"time"

	"github.com/henrygd/beszel/internal/entities/system"
)

// readBootEvents is not supported on this OS: the hub derives boots from the uptime.
func readBootEvents(context.Context, time.Time) (system.BootEventsResponse, error) {
	return system.BootEventsResponse{}, nil
}
