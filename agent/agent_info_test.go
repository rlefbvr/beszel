//go:build testing

package agent

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/henrygd/beszel/internal/common"
	"github.com/henrygd/beszel/internal/entities/system"
	"github.com/henrygd/beszel/internal/hub/transport"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLogBuffer(t *testing.T) {
	b := newLogBuffer(3)
	fmt.Fprint(b, "one\ntwo\nthr")
	assert.Equal(t, "one\ntwo", b.String(), "incomplete lines wait for their end")
	fmt.Fprint(b, "ee\r\nfour\nfive\n")
	assert.Equal(t, "three\nfour\nfive", b.String(), "the oldest lines are dropped")
}

func TestSelfUpdateSupport(t *testing.T) {
	writable := filepath.Join(t.TempDir(), "beszel-agent")

	ok, blocker := selfUpdateSupport(system.ServiceManagerNSSM, writable)
	assert.True(t, ok)
	assert.Empty(t, blocker)

	ok, blocker = selfUpdateSupport(system.ServiceManagerDocker, writable)
	assert.False(t, ok)
	assert.Equal(t, system.SelfUpdateContainer, blocker)

	ok, blocker = selfUpdateSupport(system.ServiceManagerManual, writable)
	assert.False(t, ok)
	assert.Equal(t, system.SelfUpdateRestart, blocker, "nothing would start the new version")

	missing := filepath.Join(t.TempDir(), "missing", "beszel-agent")
	ok, blocker = selfUpdateSupport(system.ServiceManagerSystemd, missing)
	assert.False(t, ok)
	assert.Equal(t, system.SelfUpdateReadOnly, blocker)
}

func TestAgentInfo(t *testing.T) {
	a := &Agent{dataDir: t.TempDir()}
	info := a.agentInfo()
	exe, _ := os.Executable()
	assert.Equal(t, exe, info.Executable)
	assert.NotEmpty(t, info.Version)
	assert.Equal(t, system.ServiceManagerManual, info.ServiceManager, "tests are not started by a service manager")
	assert.False(t, info.SelfUpdate)
	var names []string
	for _, dep := range info.Dependencies {
		names = append(names, dep.Name)
	}
	assert.Contains(t, strings.Join(names, ","), "smartctl")
}

// The responses of the fork's requests must reach the hub through the generic
// Data field: bare strings go to a legacy field only read for container logs.
func TestForkResponsesReachTheHub(t *testing.T) {
	logs := system.AgentLogsResponse{Logs: "line 1\nline 2"}
	var gotLogs system.AgentLogsResponse
	require.NoError(t, transport.UnmarshalResponse(newAgentResponse(logs, nil), common.GetAgentLogs, &gotLogs))
	assert.Equal(t, logs, gotLogs)

	info := system.AgentInfo{Version: "0.20.0-fork.3", ServiceManager: system.ServiceManagerNSSM}
	var gotInfo system.AgentInfo
	require.NoError(t, transport.UnmarshalResponse(newAgentResponse(info, nil), common.GetAgentInfo, &gotInfo))
	assert.Equal(t, info, gotInfo)

	update := system.AgentUpdateResponse{Error: system.SelfUpdateRestart}
	var gotUpdate system.AgentUpdateResponse
	require.NoError(t, transport.UnmarshalResponse(newAgentResponse(update, nil), common.UpdateAgent, &gotUpdate))
	assert.Equal(t, update, gotUpdate)

	boots := system.BootEventsResponse{Source: system.BootSourceJournal}
	var gotBoots system.BootEventsResponse
	require.NoError(t, transport.UnmarshalResponse(newAgentResponse(boots, nil), common.GetBootEvents, &gotBoots))
	assert.Equal(t, boots, gotBoots)
}
