package systems

import (
	"context"
	"time"

	"github.com/henrygd/beszel/internal/common"
	"github.com/henrygd/beszel/internal/entities/system"
)

// agentUpdateTimeout leaves time for the agent to download and verify the release.
const agentUpdateTimeout = 3 * time.Minute

// FetchAgentInfo fetches how the agent runs on its host.
func (sys *System) FetchAgentInfo() (system.AgentInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var info system.AgentInfo
	err := sys.forkRequest(ctx, common.GetAgentInfo, nil, &info)
	return info, err
}

// FetchAgentLogs fetches the last lines logged by the agent.
func (sys *System) FetchAgentLogs() (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var response system.AgentLogsResponse
	err := sys.forkRequest(ctx, common.GetAgentLogs, nil, &response)
	return response.Logs, err
}

// UpdateAgent asks the agent to update itself to the latest release. An
// updated agent restarts and reconnects on its own.
func (sys *System) UpdateAgent() (system.AgentUpdateResponse, error) {
	ctx, cancel := context.WithTimeout(context.Background(), agentUpdateTimeout)
	defer cancel()
	var response system.AgentUpdateResponse
	err := sys.forkRequest(ctx, common.UpdateAgent, nil, &response)
	return response, err
}
