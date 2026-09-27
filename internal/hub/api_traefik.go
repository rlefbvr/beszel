package hub

import (
	"errors"
	"net/http"
	"strings"
	"sync"

	"github.com/henrygd/beszel/internal/entities/system"
	"github.com/henrygd/beszel/internal/hub/systems"
	"github.com/pocketbase/pocketbase/core"
)

// traefikOverview is the answer of a host about its Traefik instances.
type traefikOverview struct {
	System    string                   `json:"system"`
	Error     string                   `json:"error,omitempty"`
	Instances []system.TraefikInstance `json:"instances"`
}

// getTraefik handles GET /api/beszel/traefik?systems=: the Traefik instances
// of several hosts, read from their agents a few at a time.
func (h *Hub) getTraefik(e *core.RequestEvent) error {
	ids := strings.Split(e.Request.URL.Query().Get("systems"), ",")
	if len(ids) > 1000 {
		return e.BadRequestError("Too many systems", nil)
	}
	var (
		mu      sync.Mutex
		wg      sync.WaitGroup
		limit   = make(chan struct{}, 8)
		results = make([]traefikOverview, 0, len(ids))
	)
	for _, id := range ids {
		sys, err := h.sm.GetSystem(id)
		if err != nil || !sys.HasUser(e.App, e.Auth) {
			continue
		}
		wg.Go(func() {
			limit <- struct{}{}
			defer func() { <-limit }()
			overview := traefikOverview{System: id, Instances: []system.TraefikInstance{}}
			response, err := sys.FetchTraefik(e.Request.Context())
			switch {
			case errors.Is(err, systems.ErrAgentOutdated):
				overview.Error = "outdated"
			case err != nil:
				overview.Error = err.Error()
			case response.Instances != nil:
				overview.Instances = response.Instances
			}
			mu.Lock()
			results = append(results, overview)
			mu.Unlock()
		})
	}
	wg.Wait()
	return e.JSON(http.StatusOK, map[string]any{"systems": results})
}

// getTraefikLog handles GET /api/beszel/traefik/log?system=&instance=&access=:
// the last lines of the log, or access log, of a Traefik instance.
func (h *Hub) getTraefikLog(e *core.RequestEvent) error {
	query := e.Request.URL.Query()
	sys, err := h.sm.GetSystem(query.Get("system"))
	if err != nil || !sys.HasUser(e.App, e.Auth) {
		return e.NotFoundError("", nil)
	}
	instance := query.Get("instance")
	if instance == "" {
		return e.BadRequestError("Invalid instance", nil)
	}
	response, err := sys.FetchTraefikLog(e.Request.Context(), instance, query.Get("access") == "1")
	switch {
	case errors.Is(err, systems.ErrAgentOutdated):
		return e.BadRequestError("outdated", nil)
	case err != nil:
		return e.BadRequestError(err.Error(), nil)
	}
	return e.JSON(http.StatusOK, response)
}
