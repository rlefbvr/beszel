package system

import "time"

// Sources of boot events.
const (
	BootSourceUptime   = "uptime"   // boot time derived from the uptime reported by the agent
	BootSourceEventLog = "eventlog" // Windows System event log
	BootSourceJournal  = "journal"  // systemd journal
	BootSourceWtmp     = "wtmp"     // login records (last -x)
)

// BootEvent is a boot of the host, with the end of the run before it.
type BootEvent struct {
	Boot time.Time `cbor:"0,keyasint"`
	// Shutdown is when the previous run ended, zero when unknown.
	Shutdown time.Time `cbor:"1,keyasint,omitzero"`
	// Unexpected reports that the previous run ended without a clean shutdown
	// (power loss, crash, hard reset).
	Unexpected bool `cbor:"2,keyasint,omitempty"`
	// Reason and User describe who requested the shutdown and why, when the
	// OS records it (Windows).
	Reason string `cbor:"3,keyasint,omitempty"`
	User   string `cbor:"4,keyasint,omitempty"`
}

// BootEventsResponse lists the boots found in the host logs.
type BootEventsResponse struct {
	// Source is one of the BootSource constants, empty when no log is readable.
	Source string      `cbor:"0,keyasint,omitempty"`
	Events []BootEvent `cbor:"1,keyasint,omitempty"`
}
