package system

import "time"

// Service managers running the agent.
const (
	ServiceManagerSystemd = "systemd"
	ServiceManagerOpenRC  = "openrc"
	ServiceManagerProcd   = "procd"
	ServiceManagerRC      = "rc"      // FreeBSD rc.d
	ServiceManagerLaunchd = "launchd" // macOS, e.g. brew services
	ServiceManagerNSSM    = "nssm"    // Windows
	ServiceManagerDocker  = "docker"  // container, updated with its image
	ServiceManagerManual  = "manual"  // started by hand
)

// Reasons why an agent can't update itself.
const (
	SelfUpdateContainer = "container" // update the image instead
	SelfUpdateRestart   = "restart"   // no service manager restarts the agent after the update
	SelfUpdateReadOnly  = "readonly"  // the agent can't replace its executable
)

// AgentInfo describes how an agent runs on its host.
type AgentInfo struct {
	Version        string            `cbor:"0,keyasint"`
	Executable     string            `cbor:"1,keyasint,omitempty"`
	DataDir        string            `cbor:"2,keyasint,omitempty"`
	User           string            `cbor:"3,keyasint,omitempty"` // account running the agent
	ServiceManager string            `cbor:"4,keyasint,omitempty"` // one of the ServiceManager constants
	ServiceName    string            `cbor:"5,keyasint,omitempty"`
	StartedAt      time.Time         `cbor:"6,keyasint,omitzero"`
	Dependencies   []AgentDependency `cbor:"7,keyasint,omitempty"`
	// SelfUpdate reports that the agent can update itself on request of the hub,
	// otherwise SelfUpdateBlocker tells why (one of the SelfUpdate constants).
	SelfUpdate        bool   `cbor:"8,keyasint,omitempty"`
	SelfUpdateBlocker string `cbor:"9,keyasint,omitempty"`
}

// AgentDependency is a tool the agent uses or can use, such as smartctl or NSSM.
type AgentDependency struct {
	Name   string `cbor:"0,keyasint"`
	Found  bool   `cbor:"1,keyasint,omitempty"`
	Detail string `cbor:"2,keyasint,omitempty"` // path or version
}

// AgentLogsResponse holds the last lines logged by the agent. A struct rather
// than a string, which agents send in the legacy field of container logs.
type AgentLogsResponse struct {
	Logs string `cbor:"0,keyasint"`
}

// AgentUpdateResponse is the outcome of an update requested by the hub.
type AgentUpdateResponse struct {
	// Updated reports that a newer version was installed: the agent restarts.
	Updated bool   `cbor:"0,keyasint,omitempty"`
	Error   string `cbor:"1,keyasint,omitempty"`
}
