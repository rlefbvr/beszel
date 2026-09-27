package systems

import (
	"context"
	"errors"

	"github.com/blang/semver"
	"github.com/henrygd/beszel"
	"github.com/henrygd/beszel/internal/common"
)

// ErrAgentOutdated is returned for the requests of this fork sent to an agent
// that does not know them.
var ErrAgentOutdated = errors.New("outdated")

// supportsForkRequests reports whether an agent version answers the requests
// added by this fork. Agents without them, including upstream ones, don't reply
// at all, so the hub would wait for the full timeout of each request.
//
// The agent announces only the upstream version when connecting, so the fork
// version is read from the system info it sends with its data.
func supportsForkRequests(agentVersion string) bool {
	version, err := semver.ParseTolerant(agentVersion)
	if err != nil || len(version.Pre) == 0 || version.Pre[0].VersionStr != "fork" {
		return false
	}
	return version.GTE(beszel.MinVersionForkRequests)
}

// supportsCertificates reports whether an agent version reads the certificates of its host.
func supportsCertificates(agentVersion string) bool {
	return supportsForkVersion(agentVersion, beszel.MinVersionCertificates)
}

// supportsForkVersion reports whether an agent of this fork is at least of a version.
func supportsForkVersion(agentVersion string, minVersion semver.Version) bool {
	version, err := semver.ParseTolerant(agentVersion)
	if err != nil || len(version.Pre) == 0 || version.Pre[0].VersionStr != "fork" {
		return false
	}
	return version.GTE(minVersion)
}

// forkRequest sends a request added by this fork, if the agent supports it.
func (sys *System) forkRequest(ctx context.Context, action common.WebSocketAction, req any, dest any) error {
	if !sys.forkRequests.Load() {
		return ErrAgentOutdated
	}
	return sys.request(ctx, action, req, dest)
}
