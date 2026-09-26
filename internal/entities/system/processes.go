package system

// Process is a process running on the host, with its use of the resources
// since the previous reading (about one second for the first one).
type Process struct {
	PID     int32  `cbor:"0,keyasint" json:"pid"`
	PPID    int32  `cbor:"1,keyasint,omitempty" json:"ppid,omitempty"`
	Name    string `cbor:"2,keyasint" json:"name"`
	User    string `cbor:"3,keyasint,omitempty" json:"user,omitempty"`
	Status  string `cbor:"4,keyasint,omitempty" json:"status,omitempty"`
	Command string `cbor:"5,keyasint,omitempty" json:"command,omitempty"`
	// CPU is the share of all the CPUs of the host, in percent
	CPU float64 `cbor:"6,keyasint,omitempty" json:"cpu,omitempty"`
	// Memory is the share of the memory of the host, in percent, and RSS its size in bytes
	Memory float64 `cbor:"7,keyasint,omitempty" json:"mem,omitempty"`
	RSS    uint64  `cbor:"8,keyasint,omitempty" json:"rss,omitempty"`
	// DiskRead and DiskWrite are bytes per second
	DiskRead  float64 `cbor:"9,keyasint,omitempty" json:"dr,omitempty"`
	DiskWrite float64 `cbor:"10,keyasint,omitempty" json:"dw,omitempty"`
	Threads   int32   `cbor:"11,keyasint,omitempty" json:"threads,omitempty"`
	// Connections is the number of open TCP and UDP sockets
	Connections int `cbor:"12,keyasint,omitempty" json:"conns,omitempty"`
	// Started is the start time, unix seconds
	Started int64 `cbor:"13,keyasint,omitempty" json:"started,omitempty"`
}

// ProcessesResponse lists the processes of the host.
type ProcessesResponse struct {
	Processes []Process `cbor:"0,keyasint,omitempty" json:"processes"`
	// Cores is the number of logical CPUs of the host
	Cores int `cbor:"1,keyasint,omitempty" json:"cores,omitempty"`
}
