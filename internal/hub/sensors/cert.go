package sensors

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net"
	"strings"
	"time"
)

// CertInfo describes the TLS certificate of an HTTPS check, shown on the page
// of its sensor.
type CertInfo struct {
	Subject    string    `json:"subject"`
	SubjectDN  string    `json:"subjectDN"`
	Issuer     string    `json:"issuer"`
	IssuerDN   string    `json:"issuerDN"`
	Names      []string  `json:"names,omitempty"`
	NotBefore  time.Time `json:"notBefore"`
	NotAfter   time.Time `json:"notAfter"`
	Serial     string    `json:"serial"`
	Signature  string    `json:"signature"`
	PublicKey  string    `json:"publicKey"`
	SHA256     string    `json:"sha256"`
	TLSVersion string    `json:"tlsVersion"`
	Cipher     string    `json:"cipher"`
	// Trusted is whether the chain is valid for the host with the roots of the hub.
	Trusted bool `json:"trusted"`
	// TrustError explains why the chain is not trusted.
	TrustError string     `json:"trustError,omitempty"`
	Chain      []CertLink `json:"chain,omitempty"`
}

// CertLink is a certificate of the chain sent by the server.
type CertLink struct {
	Subject  string    `json:"subject"`
	Issuer   string    `json:"issuer"`
	NotAfter time.Time `json:"notAfter"`
}

// certInfo describes the certificate of a TLS connection to the host, nil without one.
func certInfo(state *tls.ConnectionState, host string) *CertInfo {
	if state == nil || len(state.PeerCertificates) == 0 {
		return nil
	}
	cert := state.PeerCertificates[0]
	info := &CertInfo{
		Subject:    commonName(cert.Subject.CommonName, cert.Subject.String()),
		SubjectDN:  cert.Subject.String(),
		Issuer:     commonName(cert.Issuer.CommonName, cert.Issuer.String()),
		IssuerDN:   cert.Issuer.String(),
		NotBefore:  cert.NotBefore.UTC(),
		NotAfter:   cert.NotAfter.UTC(),
		Serial:     colonHex(cert.SerialNumber.Bytes()),
		Signature:  cert.SignatureAlgorithm.String(),
		PublicKey:  publicKeyName(cert.PublicKey),
		TLSVersion: tls.VersionName(state.Version),
		Cipher:     tls.CipherSuiteName(state.CipherSuite),
	}
	sum := sha256.Sum256(cert.Raw)
	info.SHA256 = colonHex(sum[:])
	info.Names = append(info.Names, cert.DNSNames...)
	for _, ip := range cert.IPAddresses {
		info.Names = append(info.Names, ip.String())
	}
	// the check can skip the verification: verify here, for the details only
	intermediates := x509.NewCertPool()
	for _, c := range state.PeerCertificates[1:] {
		intermediates.AddCert(c)
	}
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	if _, err := cert.Verify(x509.VerifyOptions{DNSName: host, Intermediates: intermediates}); err != nil {
		info.TrustError = err.Error()
	} else {
		info.Trusted = true
	}
	for _, c := range state.PeerCertificates[1:] {
		info.Chain = append(info.Chain, CertLink{
			Subject:  commonName(c.Subject.CommonName, c.Subject.String()),
			Issuer:   commonName(c.Issuer.CommonName, c.Issuer.String()),
			NotAfter: c.NotAfter.UTC(),
		})
	}
	return info
}

func commonName(cn, dn string) string {
	if cn != "" {
		return cn
	}
	return dn
}

// colonHex formats bytes as AB:CD:EF.
func colonHex(b []byte) string {
	parts := make([]string, len(b))
	for i, v := range b {
		parts[i] = fmt.Sprintf("%02X", v)
	}
	return strings.Join(parts, ":")
}

// publicKeyName names the algorithm and size of a public key, such as "RSA 2048" or "ECDSA P-256".
func publicKeyName(key any) string {
	switch k := key.(type) {
	case *rsa.PublicKey:
		return fmt.Sprintf("RSA %d", k.N.BitLen())
	case *ecdsa.PublicKey:
		return "ECDSA " + k.Curve.Params().Name
	case ed25519.PublicKey:
		return "Ed25519"
	}
	return fmt.Sprintf("%T", key)
}
