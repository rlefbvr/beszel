//go:build windows && testing

package agent

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWindowsSystemdManager(t *testing.T) {
	sm, err := newSystemdManager()
	require.NoError(t, err)
	require.NotNil(t, sm)

	// Le relevé initial rend les données fraîches, comme sous Linux.
	assert.True(t, sm.hasFreshStats)
	count := sm.getServiceStatsCount()
	assert.Greater(t, count, 0)
	assert.LessOrEqual(t, int(sm.getFailedServiceCount()), count)

	services := sm.getServiceStats(nil, false)
	assert.Len(t, services, count)
	assert.False(t, sm.hasFreshStats)

	details, err := sm.getServiceDetails(services[0].Name)
	require.NoError(t, err)
	assert.Equal(t, services[0].Name, details["Id"])
	assert.NotEmpty(t, details["ActiveState"])
	assert.NotEmpty(t, details["UnitFileState"])

	_, err = sm.getServiceDetails("service-inexistant")
	assert.Error(t, err)
}
