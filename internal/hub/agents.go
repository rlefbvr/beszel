package hub

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/henrygd/beszel/internal/ghupdate"
	"github.com/henrygd/beszel/internal/hub/systems"
	"github.com/pocketbase/pocketbase/core"
)

// latestAgentRelease caches the version of the latest release of the agent.
type latestAgentRelease struct {
	mu        sync.Mutex
	version   string
	checkedAt time.Time
}

// latestReleaseTTL is how long the latest version is cached; failed checks are retried sooner.
const (
	latestReleaseTTL      = time.Hour
	latestReleaseRetryTTL = 5 * time.Minute
)

func (l *latestAgentRelease) get() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	ttl := latestReleaseTTL
	if l.version == "" {
		ttl = latestReleaseRetryTTL
	}
	if time.Since(l.checkedAt) < ttl {
		return l.version
	}
	l.checkedAt = time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if release, err := ghupdate.FetchLatestRelease(ctx, http.DefaultClient, ""); err == nil {
		l.version = strings.TrimPrefix(release.Tag, "v")
	}
	return l.version
}

// systemForAgentRequest returns the system of a request if the user can access it.
func (h *Hub) systemForAgentRequest(e *core.RequestEvent, systemID string) (*systems.System, error) {
	if systemID == "" {
		return nil, e.BadRequestError("Invalid system parameter", nil)
	}
	system, err := h.sm.GetSystem(systemID)
	if err != nil || !system.HasUser(e.App, e.Auth) {
		return nil, e.NotFoundError("", nil)
	}
	return system, nil
}

// getAgentInfo handles GET /api/beszel/agent/info requests
func (h *Hub) getAgentInfo(e *core.RequestEvent) error {
	system, err := h.systemForAgentRequest(e, e.Request.URL.Query().Get("system"))
	if err != nil {
		return err
	}
	info, err := system.FetchAgentInfo()
	if err != nil {
		return agentRequestError(e, err)
	}
	return e.JSON(http.StatusOK, info)
}

// getAgentLogs handles GET /api/beszel/agent/logs requests
func (h *Hub) getAgentLogs(e *core.RequestEvent) error {
	system, err := h.systemForAgentRequest(e, e.Request.URL.Query().Get("system"))
	if err != nil {
		return err
	}
	logs, err := system.FetchAgentLogs()
	if err != nil {
		return agentRequestError(e, err)
	}
	return e.JSON(http.StatusOK, map[string]string{"logs": logs})
}

// agentRequestError tells agents too old for the request apart from failures.
func agentRequestError(e *core.RequestEvent, err error) error {
	if errors.Is(err, systems.ErrAgentOutdated) {
		return e.Error(http.StatusConflict, err.Error(), nil)
	}
	return e.InternalServerError("", err)
}

// getLatestAgentVersion handles GET /api/beszel/agent/latest requests
func (h *Hub) getLatestAgentVersion(e *core.RequestEvent) error {
	return e.JSON(http.StatusOK, map[string]string{"version": h.latestAgent.get()})
}

// agentUpdateResult is the outcome of the update of one agent.
type agentUpdateResult struct {
	Updated bool   `json:"updated"`
	Error   string `json:"error,omitempty"`
}

// updateAgents handles POST /api/beszel/agent/update requests: the listed
// agents update themselves to the latest release, in parallel.
func (h *Hub) updateAgents(e *core.RequestEvent) error {
	var body struct {
		Systems []string `json:"systems"`
	}
	if err := e.BindBody(&body); err != nil || len(body.Systems) == 0 {
		return e.BadRequestError("Invalid systems parameter", err)
	}
	var (
		mu      sync.Mutex
		wg      sync.WaitGroup
		results = make(map[string]agentUpdateResult, len(body.Systems))
	)
	for _, systemID := range body.Systems {
		system, err := h.sm.GetSystem(systemID)
		if err != nil || !system.HasUser(e.App, e.Auth) {
			results[systemID] = agentUpdateResult{Error: "not found"}
			continue
		}
		wg.Go(func() {
			result := agentUpdateResult{}
			if response, err := system.UpdateAgent(); err != nil {
				result.Error = err.Error()
			} else {
				result.Updated, result.Error = response.Updated, response.Error
			}
			mu.Lock()
			results[systemID] = result
			mu.Unlock()
		})
	}
	wg.Wait()
	return e.JSON(http.StatusOK, results)
}
