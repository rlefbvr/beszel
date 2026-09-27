package system

// CertUseTraefik is a certificate served by Traefik: obtained by one of its
// ACME resolvers (Let's Encrypt), or a file of its file provider.
const CertUseTraefik = "traefik"

// TraefikRoute is an HTTP router of a Traefik instance.
type TraefikRoute struct {
	// Router is the name of the router, such as "whoami@docker".
	Router string `cbor:"0,keyasint" json:"router"`
	Rule   string `cbor:"1,keyasint,omitempty" json:"rule,omitempty"`
	// Hosts are the names of the Host() matchers of the rule.
	Hosts []string `cbor:"2,keyasint,omitempty" json:"hosts,omitempty"`
	TLS   bool     `cbor:"3,keyasint,omitempty" json:"tls,omitempty"`
	// Resolver is the ACME resolver giving the certificate of the router.
	Resolver    string   `cbor:"4,keyasint,omitempty" json:"resolver,omitempty"`
	EntryPoints []string `cbor:"5,keyasint,omitempty" json:"entryPoints,omitempty"`
	// Container is the container the router sends to (docker provider).
	Container string `cbor:"6,keyasint,omitempty" json:"container,omitempty"`
	Service   string `cbor:"7,keyasint,omitempty" json:"service,omitempty"`
	// Provider is where the router is defined: docker or file.
	Provider string `cbor:"8,keyasint,omitempty" json:"provider,omitempty"`
}

// TraefikResolver is an ACME resolver of a Traefik instance.
type TraefikResolver struct {
	Name string `cbor:"0,keyasint" json:"name"`
	// Storage is the acme.json file on the host.
	Storage string `cbor:"1,keyasint,omitempty" json:"storage,omitempty"`
	// Certificates is the number of certificates in the storage.
	Certificates int    `cbor:"2,keyasint,omitempty" json:"certificates,omitempty"`
	Error        string `cbor:"3,keyasint,omitempty" json:"error,omitempty"`
}

// TraefikInstance is a Traefik running on the host, in a container or as a service.
type TraefikInstance struct {
	// Id is the id of the container, empty for a service.
	Id      string `cbor:"0,keyasint,omitempty" json:"id,omitempty"`
	Name    string `cbor:"1,keyasint" json:"name"`
	Image   string `cbor:"2,keyasint,omitempty" json:"image,omitempty"`
	Version string `cbor:"3,keyasint,omitempty" json:"version,omitempty"`
	State   string `cbor:"4,keyasint,omitempty" json:"state,omitempty"`
	Status  string `cbor:"5,keyasint,omitempty" json:"status,omitempty"`
	// ConfigFile is the static configuration file on the host.
	ConfigFile string `cbor:"6,keyasint,omitempty" json:"configFile,omitempty"`
	// Dashboard is the address of the dashboard through a router of the instance.
	Dashboard string `cbor:"7,keyasint,omitempty" json:"dashboard,omitempty"`
	// DashboardPort is the port of the host publishing the insecure API and dashboard.
	DashboardPort uint16 `cbor:"8,keyasint,omitempty" json:"dashboardPort,omitempty"`
	// Log and AccessLog are "file:<path on the host>", "stdout", or empty when not enabled.
	Log       string            `cbor:"9,keyasint,omitempty" json:"log,omitempty"`
	AccessLog string            `cbor:"10,keyasint,omitempty" json:"accessLog,omitempty"`
	Resolvers []TraefikResolver `cbor:"11,keyasint,omitempty" json:"resolvers,omitempty"`
	Routes    []TraefikRoute    `cbor:"12,keyasint,omitempty" json:"routes,omitempty"`
	// Error tells what could not be read, such as a configuration file.
	Error string `cbor:"13,keyasint,omitempty" json:"error,omitempty"`
}

// TraefikResponse lists the Traefik instances of the host.
type TraefikResponse struct {
	Instances []TraefikInstance `cbor:"0,keyasint,omitempty" json:"instances"`
}

// TraefikLogRequest asks for the last lines of a log of a Traefik instance.
type TraefikLogRequest struct {
	// Instance is the name of the instance.
	Instance string `cbor:"0,keyasint"`
	// Access asks for the access log instead of the log of Traefik.
	Access bool `cbor:"1,keyasint,omitempty"`
}

// TraefikLogResponse holds the last lines of a log.
type TraefikLogResponse struct {
	Lines string `cbor:"0,keyasint,omitempty" json:"lines"`
	// Source is where the lines come from: a file of the host or the output of the container.
	Source string `cbor:"1,keyasint,omitempty" json:"source"`
}
