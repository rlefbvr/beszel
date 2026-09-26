// Package beszel provides core application constants and version information
// which are used throughout the application.
package beszel

import "github.com/blang/semver"

const (
	// Version is the upstream Beszel version this fork is based on. Hub and agent
	// use it to negotiate features, so it must follow the upstream version.
	Version = "0.20.0"
	// ForkRevision numbers the releases of this fork based on the same Version.
	// Increment it for each release and reset it to 1 when Version changes.
	ForkRevision = "4"
	// ForkVersion identifies the releases of this fork (tag v<ForkVersion>) and is
	// the version compared for updates and shown to users.
	ForkVersion = Version + "-fork." + ForkRevision
	// AppName is the name of the application.
	AppName = "beszel"
	// RepoOwner and RepoName are the GitHub repository releases are downloaded from.
	RepoOwner = "rlefbvr"
	RepoName  = "beszel"
)

// MinVersionCbor is the minimum supported version for CBOR compatibility.
var MinVersionCbor = semver.MustParse("0.12.0")

// MinVersionAgentResponse is the minimum supported version for AgentResponse compatibility.
var MinVersionAgentResponse = semver.MustParse("0.13.0")

// MinVersionZfsData is the minimum agent version that supports ZFS detail requests.
var MinVersionZfsData = semver.MustParse("0.18.9")

// MinVersionNetworkMonitors is the minimum agent version that supports network monitor sync.
var MinVersionNetworkMonitors = semver.MustParse("0.20.0")

// MinVersionForkRequests is the minimum fork agent version that answers the
// requests added by this fork.
var MinVersionForkRequests = semver.MustParse("0.20.0-fork.3")
