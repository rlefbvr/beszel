//go:build testing

package systems

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSupportsForkRequests(t *testing.T) {
	tests := []struct {
		version string
		want    bool
	}{
		{"0.20.0-fork.3", true},
		{"0.20.0-fork.12", true},
		{"0.21.0-fork.1", true},
		{"0.20.0-fork.2", false},
		{"0.20.0-fork.1", false},
		{"0.20.0", false},  // upstream agent
		{"0.21.0", false},  // newer upstream agent
		{"", false},        // not reported yet
		{"invalid", false}, // unparsable
	}
	for _, tt := range tests {
		assert.Equal(t, tt.want, supportsForkRequests(tt.version), tt.version)
	}
}
