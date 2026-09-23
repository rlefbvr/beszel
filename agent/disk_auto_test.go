//go:build testing

package agent

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestDisplayDevice(t *testing.T) {
	assert.Equal(t, "C:", displayDevice("c:", true))
	assert.Equal(t, "", displayDevice(`\?\Volume{x}`, true))
	assert.Equal(t, "/dev/sda1", displayDevice("/dev/sda1", false))
	assert.Equal(t, "", displayDevice("zroot/ROOT/default", false))
	assert.Equal(t, "", displayDevice("sda1", false))
}

func TestAutoFilesystemsEnabledEnv(t *testing.T) {
	t.Setenv("AUTO_FILESYSTEMS", "false")
	assert.False(t, autoFilesystemsEnabled())
	t.Setenv("AUTO_FILESYSTEMS", "true")
	assert.True(t, autoFilesystemsEnabled())
}
