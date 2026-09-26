//go:build testing

package systems

import (
	"testing"

	"github.com/henrygd/beszel/internal/entities/system"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSummarizeProcesses(t *testing.T) {
	list := []system.Process{
		{PID: 1, Name: "init", CPU: 0, Memory: 0.1},
		{PID: 20, Name: "nginx", Command: "nginx: worker process", User: "www-data", CPU: 3, Memory: 1},
		{PID: 21, Name: "nginx", Command: "nginx: master process", User: "root", CPU: 0.5, Memory: 0.5},
		{PID: 30, Name: "postgres", CPU: 10, Memory: 20},
		{PID: 40, Name: "idle", CPU: 0, Memory: 0},
	}

	overview := SummarizeProcesses("sys", list, OverviewOptions{Top: 2})
	assert.Equal(t, 5, overview.Count)
	assert.InDelta(t, 13.5, overview.CPU, 0.001)
	assert.Equal(t, []int32{30, 20}, pids(overview.TopCPU))
	assert.Equal(t, []int32{30, 20}, pids(overview.TopMemory))
	assert.Empty(t, overview.Matches)

	// the processes without use are left out of the top
	overview = SummarizeProcesses("sys", list, OverviewOptions{Top: 20})
	assert.Equal(t, []int32{30, 20, 21}, pids(overview.TopCPU))

	// all the terms must match, in the name, command, user or PID
	overview = SummarizeProcesses("sys", list, OverviewOptions{Search: "NGINX worker"})
	assert.Nil(t, overview.TopCPU)
	assert.Equal(t, []int32{20}, pids(overview.Matches))
	overview = SummarizeProcesses("sys", list, OverviewOptions{Search: "nginx"})
	assert.Equal(t, []int32{20, 21}, pids(overview.Matches))
	overview = SummarizeProcesses("sys", list, OverviewOptions{Search: "30"})
	assert.Equal(t, []int32{30}, pids(overview.Matches))
	assert.Nil(t, overview.Programs)
	assert.Nil(t, overview.Recent)
}

func TestSummarizeProcessesProgramsAndRecent(t *testing.T) {
	list := []system.Process{
		{PID: 1, Name: "init", Started: 100},
		{PID: 20, Name: "nginx", CPU: 3, Memory: 1, RSS: 100, Started: 900},
		{PID: 21, Name: "nginx", CPU: 0.5, Memory: 0.5, RSS: 50, Started: 1000},
		{PID: 30, Name: "postgres", CPU: 10, Memory: 20, RSS: 2000, Started: 500},
	}
	overview := SummarizeProcesses("sys", list, OverviewOptions{Programs: true, RecentSince: 800})
	require.Len(t, overview.Programs, 3)
	assert.Equal(t, ProcessProgram{Name: "postgres", Count: 1, CPU: 10, Memory: 20, RSS: 2000}, overview.Programs[0])
	assert.Equal(t, ProcessProgram{Name: "nginx", Count: 2, CPU: 3.5, Memory: 1.5, RSS: 150}, overview.Programs[1])
	// the newest first
	assert.Equal(t, []int32{21, 20}, pids(overview.Recent))
}

func pids(list []system.Process) []int32 {
	out := make([]int32, 0, len(list))
	for _, p := range list {
		out = append(out, p.PID)
	}
	return out
}
