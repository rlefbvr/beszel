package systems

import (
	"context"
	"time"

	"github.com/henrygd/beszel/internal/common"
	"github.com/henrygd/beszel/internal/entities/system"
)

// FetchTraefik asks the agent for the Traefik instances of the host. Agents
// from 0.20.0-fork.6 answer it.
func (sys *System) FetchTraefik(ctx context.Context) (system.TraefikResponse, error) {
	var response system.TraefikResponse
	if !sys.traefik.Load() {
		return response, ErrAgentOutdated
	}
	ctx, cancel := context.WithTimeout(ctx, 40*time.Second)
	defer cancel()
	err := sys.forkRequest(ctx, common.GetTraefik, nil, &response)
	return response, err
}

// FetchTraefikLog asks the agent for the last lines of the log, or access log,
// of a Traefik instance of the host.
func (sys *System) FetchTraefikLog(ctx context.Context, instance string, access bool) (system.TraefikLogResponse, error) {
	var response system.TraefikLogResponse
	if !sys.traefik.Load() {
		return response, ErrAgentOutdated
	}
	ctx, cancel := context.WithTimeout(ctx, 40*time.Second)
	defer cancel()
	err := sys.forkRequest(ctx, common.GetTraefikLog, system.TraefikLogRequest{Instance: instance, Access: access}, &response)
	return response, err
}
