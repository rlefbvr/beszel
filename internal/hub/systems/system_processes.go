package systems

import (
	"cmp"
	"context"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/henrygd/beszel/internal/common"
	"github.com/henrygd/beszel/internal/entities/system"
	"github.com/pocketbase/pocketbase/core"
)

const (
	// maxProcessMatches caps the processes found by a search on each host
	maxProcessMatches = 100
	// maxRecentProcesses caps the recently started processes of each host
	maxRecentProcesses = 30
)

// FetchProcesses asks the agent for the processes of the host. Agents from
// 0.20.0-fork.5 answer it, like the certificates request.
func (sys *System) FetchProcesses(ctx context.Context) (system.ProcessesResponse, error) {
	var response system.ProcessesResponse
	if !sys.certificates.Load() {
		return response, ErrAgentOutdated
	}
	ctx, cancel := context.WithTimeout(ctx, 40*time.Second)
	defer cancel()
	err := sys.forkRequest(ctx, common.GetProcesses, nil, &response)
	return response, err
}

// checkProcessAlerts reads the processes of the host for its process rules, in
// the background so that the update of the system does not wait for it. Only
// the hosts with process rules are read, once per update at most.
func (sys *System) checkProcessAlerts(systemRecord *core.Record) {
	hub := sys.manager.hub
	if !sys.certificates.Load() || !hub.HasProcessAlerts(sys.Id) || !sys.processAlertsBusy.CompareAndSwap(false, true) {
		return
	}
	go func() {
		defer sys.processAlertsBusy.Store(false)
		response, err := sys.FetchProcesses(sys.manager.ctx)
		if err != nil {
			hub.Logger().Debug("Error reading processes for alerts", "system", sys.Id, "err", err)
			return
		}
		if err := hub.HandleProcessAlerts(systemRecord, response.Processes); err != nil {
			hub.Logger().Error("Error handling process alerts", "err", err)
		}
	}()
}

// ProcessesOverview sums up the processes of a host for the page of all the
// processes: its top consumers, its programs, the processes started recently,
// or the processes matching a search.
type ProcessesOverview struct {
	System    string           `json:"system"`
	Error     string           `json:"error,omitempty"`
	Count     int              `json:"count"`
	Threads   int              `json:"threads"`
	CPU       float64          `json:"cpu"`
	Memory    float64          `json:"mem"`
	TopCPU    []system.Process `json:"topCpu,omitempty"`
	TopMemory []system.Process `json:"topMem,omitempty"`
	Programs  []ProcessProgram `json:"programs,omitempty"`
	Recent    []system.Process `json:"recent,omitempty"`
	// RecentCount is the number of processes started recently, Recent keeps the newest
	RecentCount int              `json:"recentCount,omitempty"`
	Matches     []system.Process `json:"matches,omitempty"`
}

// ProcessProgram adds up the instances of a program on a host.
type ProcessProgram struct {
	Name   string  `json:"name"`
	Count  int     `json:"count"`
	CPU    float64 `json:"cpu"`
	Memory float64 `json:"mem"`
	RSS    uint64  `json:"rss"`
}

// OverviewOptions choose what the overview of a host keeps.
type OverviewOptions struct {
	// Top is the number of top consumers of CPU and of memory
	Top int
	// Search keeps the processes containing all its terms
	Search string
	// Programs adds up the instances of each program
	Programs bool
	// RecentSince keeps the processes started since this time (unix seconds)
	RecentSince int64
}

// SummarizeProcesses sums up the processes of a host as the options ask.
func SummarizeProcesses(systemID string, list []system.Process, options OverviewOptions) ProcessesOverview {
	overview := ProcessesOverview{System: systemID, Count: len(list)}
	top, search := options.Top, options.Search
	programs := map[string]*ProcessProgram{}
	for _, p := range list {
		overview.CPU += p.CPU
		overview.Memory += p.Memory
		overview.Threads += int(p.Threads)
		if options.Programs && p.Name != "" {
			program := programs[p.Name]
			if program == nil {
				program = &ProcessProgram{Name: p.Name}
				programs[p.Name] = program
			}
			program.Count++
			program.CPU += p.CPU
			program.Memory += p.Memory
			program.RSS += p.RSS
		}
		if options.RecentSince > 0 && p.Started >= options.RecentSince {
			overview.Recent = append(overview.Recent, p)
		}
	}
	for _, program := range programs {
		overview.Programs = append(overview.Programs, *program)
	}
	slices.SortFunc(overview.Programs, func(a, b ProcessProgram) int {
		return cmp.Or(cmp.Compare(b.CPU, a.CPU), cmp.Compare(a.Name, b.Name))
	})
	slices.SortStableFunc(overview.Recent, func(a, b system.Process) int { return cmp.Compare(b.Started, a.Started) })
	overview.RecentCount = len(overview.Recent)
	if len(overview.Recent) > maxRecentProcesses {
		overview.Recent = overview.Recent[:maxRecentProcesses]
	}
	if top > 0 {
		overview.TopCPU = topProcesses(list, top, func(p system.Process) float64 { return p.CPU })
		overview.TopMemory = topProcesses(list, top, func(p system.Process) float64 { return p.Memory })
	}
	if terms := strings.Fields(strings.ToLower(search)); len(terms) > 0 {
		for _, p := range list {
			text := strings.ToLower(p.Name + " " + p.Command + " " + p.User + " " + strconv.Itoa(int(p.PID)))
			if !slices.ContainsFunc(terms, func(term string) bool { return !strings.Contains(text, term) }) {
				overview.Matches = append(overview.Matches, p)
			}
		}
		slices.SortStableFunc(overview.Matches, func(a, b system.Process) int { return cmp.Compare(b.CPU, a.CPU) })
		if len(overview.Matches) > maxProcessMatches {
			overview.Matches = overview.Matches[:maxProcessMatches]
		}
	}
	return overview
}

// topProcesses returns the n processes with the largest value, without the unused ones.
func topProcesses(list []system.Process, n int, value func(system.Process) float64) []system.Process {
	sorted := slices.Clone(list)
	slices.SortStableFunc(sorted, func(a, b system.Process) int { return cmp.Compare(value(b), value(a)) })
	sorted = sorted[:min(n, len(sorted))]
	for i, p := range sorted {
		if value(p) <= 0 {
			return sorted[:i]
		}
	}
	return sorted
}
