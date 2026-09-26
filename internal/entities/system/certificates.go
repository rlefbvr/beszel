package system

import "time"

// Kinds of use of a certificate on a host: the service or file telling where
// the certificate is configured, and so where to change it.
const (
	CertUseNginx       = "nginx"       // ssl_certificate of a server block
	CertUseApache      = "apache"      // SSLCertificateFile of a virtual host
	CertUseHAProxy     = "haproxy"     // crt of a bind line
	CertUsePostfix     = "postfix"     // smtpd_tls_cert_file
	CertUseDovecot     = "dovecot"     // ssl_cert
	CertUseLetsEncrypt = "letsencrypt" // certificate renewed by certbot
	CertUseProxmox     = "proxmox"     // pveproxy certificate
	CertUseCockpit     = "cockpit"     // certificate of the web console
	CertUseIIS         = "iis"         // HTTPS binding of an IIS site
	CertUseHTTPSys     = "httpsys"     // HTTP.sys binding of another application
	CertUseRDP         = "rdp"         // Remote Desktop listener
	CertUseWinRM       = "winrm"       // WinRM HTTPS listener
	CertUseFile        = "file"        // file added by a user
)

// CertificatesRequest asks for the certificates of the host, and for the
// certificate files added by the users.
type CertificatesRequest struct {
	Paths []string `cbor:"0,keyasint,omitempty"`
}

// CertificateUse is a place where a certificate is configured on the host.
type CertificateUse struct {
	// Kind is one of the CertUse constants.
	Kind string `cbor:"0,keyasint" json:"kind"`
	// Location is the configuration file and line, the binding or the store.
	Location string `cbor:"1,keyasint,omitempty" json:"location,omitempty"`
	// Detail names what uses it: server name, IIS site, port.
	Detail string `cbor:"2,keyasint,omitempty" json:"detail,omitempty"`
}

// Certificate is a server certificate found on the host.
type Certificate struct {
	// Key identifies the certificate on the host: "file:<path>" or "store:<store>\<thumbprint>".
	Key string `cbor:"0,keyasint"`
	// Path is where the certificate is: a file, or a Windows store path such as Cert:\LocalMachine\My\<thumbprint>.
	Path        string    `cbor:"1,keyasint,omitempty"`
	Subject     string    `cbor:"2,keyasint,omitempty"`
	Issuer      string    `cbor:"3,keyasint,omitempty"`
	Names       []string  `cbor:"4,keyasint,omitempty"`
	NotBefore   time.Time `cbor:"5,keyasint,omitzero"`
	NotAfter    time.Time `cbor:"6,keyasint,omitzero"`
	Fingerprint string    `cbor:"7,keyasint,omitempty"` // SHA-256 of the certificate, hex
	Thumbprint  string    `cbor:"8,keyasint,omitempty"` // SHA-1 of the certificate, hex (Windows)
	Serial      string    `cbor:"9,keyasint,omitempty"`
	SelfSigned  bool      `cbor:"10,keyasint,omitempty"`
	// Custom tells a file added by a user.
	Custom bool `cbor:"11,keyasint,omitempty"`
	// Error tells why the certificate could not be read.
	Error string           `cbor:"12,keyasint,omitempty"`
	Uses  []CertificateUse `cbor:"13,keyasint,omitempty"`
}

// CertificatesResponse lists the certificates of the host.
type CertificatesResponse struct {
	Certificates []Certificate `cbor:"0,keyasint,omitempty"`
}
