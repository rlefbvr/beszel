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
)

// maxProcessMatches caps the processes found by a search on each host
const maxProcessMatches = 100

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

// ProcessesOverview sums up the processes of a host for the page of all the
// processes: its top consumers, or the processes matching a search.
type ProcessesOverview struct {
	System    string           `json:"system"`
	Error     string           `json:"error,omitempty"`
	Count     int              `json:"count"`
	CPU       float64          `json:"cpu"`
	Memory    float64          `json:"mem"`
	TopCPU    []system.Process `json:"topCpu,omitempty"`
	TopMemory []system.Process `json:"topMem,omitempty"`
	Matches   []system.Process `json:"matches,omitempty"`
}

// SummarizeProcesses keeps the top consumers of CPU and memory of a host, and
// the processes whose name, command, user or PID contain all the search terms.
func SummarizeProcesses(systemID string, list []system.Process, top int, search string) ProcessesOverview {
	overview := ProcessesOverview{System: systemID, Count: len(list)}
	for _, p := range list {
		overview.CPU += p.CPU
		overview.Memory += p.Memory
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
