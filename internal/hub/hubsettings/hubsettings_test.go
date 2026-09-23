//go:build testing

package hubsettings_test

import (
	"testing"
	"time"

	"github.com/henrygd/beszel/internal/hub/hubsettings"
	"github.com/henrygd/beszel/internal/tests"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestServicesInterval(t *testing.T) {
	hub, err := tests.NewTestHub(t.TempDir())
	require.NoError(t, err)
	defer hub.Cleanup()
	hubsettings.BindEvents(hub)

	// the migration creates the settings record with the default interval
	assert.Equal(t, hubsettings.DefaultServicesInterval, hubsettings.ServicesInterval(hub))

	settings, err := hub.FindRecordById(hubsettings.CollectionName, hubsettings.RecordID)
	require.NoError(t, err)
	settings.Set("services_interval", 5)
	require.NoError(t, hub.Save(settings))
	assert.Equal(t, 5*time.Minute, hubsettings.ServicesInterval(hub))

	// values outside 1-60 minutes are rejected
	settings.Set("services_interval", 0)
	assert.Error(t, hub.Save(settings))
	settings.Set("services_interval", 61)
	assert.Error(t, hub.Save(settings))

	settings.Set("services_interval", 10)
	require.NoError(t, hub.Save(settings))
	assert.Equal(t, 10*time.Minute, hubsettings.ServicesInterval(hub))
}

func TestAgentServiceName(t *testing.T) {
	hub, err := tests.NewTestHub(t.TempDir())
	require.NoError(t, err)
	defer hub.Cleanup()

	// the migration sets the default service name
	settings, err := hub.FindRecordById(hubsettings.CollectionName, hubsettings.RecordID)
	require.NoError(t, err)
	assert.Equal(t, "beszel-agent", settings.GetString("agent_service_name"))

	settings.Set("agent_service_name", "monitoring-agent")
	require.NoError(t, hub.Save(settings))

	// names unsafe in file names or shell commands are rejected
	for _, name := range []string{"", "-flag", "my agent", "agent;reboot", `a"b`, "a/b"} {
		settings.Set("agent_service_name", name)
		assert.Error(t, hub.Save(settings), name)
	}
}
