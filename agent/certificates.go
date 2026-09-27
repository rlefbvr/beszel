package agent

import (
	"bytes"
	"context"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/fxamacker/cbor/v2"
	"github.com/henrygd/beszel/internal/entities/system"
)

// maxCertificates caps the certificates returned to the hub.
const maxCertificates = 500

// maxCertificateFileSize skips files too large to be certificates.
const maxCertificateFileSize = 1 << 20

// GetCertificatesHandler returns the server certificates of the host: the ones
// configured in its services, and the files added by the users.
type GetCertificatesHandler struct{}

func (h *GetCertificatesHandler) Handle(hctx *HandlerContext) error {
	var req system.CertificatesRequest
	_ = cbor.Unmarshal(hctx.Request.Data, &req)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	inv := newCertInventory()
	discoverCertificates(ctx, inv)
	discoverTraefikCertificates(ctx, hctx.Agent.dockerManager, inv)
	for _, path := range req.Paths {
		inv.addCustomFile(path)
	}
	return hctx.SendResponse(system.CertificatesResponse{Certificates: inv.list()}, hctx.RequestID)
}

// certInventory gathers the certificates of the host, one per certificate: the
// uses of the same certificate found in several places are merged.
type certInventory struct {
	certs         []*system.Certificate
	byKey         map[string]*system.Certificate
	byFingerprint map[string]*system.Certificate
}

func newCertInventory() *certInventory {
	return &certInventory{byKey: map[string]*system.Certificate{}, byFingerprint: map[string]*system.Certificate{}}
}

// list returns the certificates in the order they were found.
func (inv *certInventory) list() []system.Certificate {
	list := make([]system.Certificate, 0, len(inv.certs))
	for _, cert := range inv.certs {
		list = append(list, *cert)
		if len(list) == maxCertificates {
			break
		}
	}
	return list
}

// add records a certificate, or adds the use to the same certificate already found.
func (inv *certInventory) add(cert *system.Certificate, use *system.CertificateUse) *system.Certificate {
	existing := inv.byKey[cert.Key]
	if existing == nil && cert.Fingerprint != "" && !cert.Custom {
		existing = inv.byFingerprint[cert.Fingerprint]
	}
	if existing == nil {
		inv.certs = append(inv.certs, cert)
		inv.byKey[cert.Key] = cert
		if cert.Fingerprint != "" && !cert.Custom {
			inv.byFingerprint[cert.Fingerprint] = cert
		}
		existing = cert
	}
	if use != nil && !slices.Contains(existing.Uses, *use) {
		existing.Uses = append(existing.Uses, *use)
	}
	return existing
}

// addFile records the certificate of a file configured in a service. A file
// that can't be read is kept with its error, so the use still shows.
func (inv *certInventory) addFile(path string, use system.CertificateUse) {
	path = filepath.Clean(path)
	cert, err := readCertificateFile(path)
	if err != nil {
		cert = &system.Certificate{Key: "file:" + path, Path: path, Error: err.Error()}
	}
	inv.add(cert, &use)
}

// addCustomFile records a certificate file added by a user.
func (inv *certInventory) addCustomFile(path string) {
	path = strings.TrimSpace(path)
	if path == "" {
		return
	}
	cert, err := readCertificateFile(filepath.Clean(path))
	if err != nil {
		cert = &system.Certificate{Key: "file:" + path, Path: path, Error: err.Error()}
	}
	cert.Key = "custom:" + path
	cert.Path = path
	cert.Custom = true
	inv.add(cert, &system.CertificateUse{Kind: system.CertUseFile, Location: path})
}

// readCertificateFile reads the first certificate of a PEM or DER file.
func readCertificateFile(path string) (*system.Certificate, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, certFileError(err)
	}
	if info.IsDir() {
		return nil, errors.New("is a directory")
	}
	if info.Size() > maxCertificateFileSize {
		return nil, errors.New("file too large")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, certFileError(err)
	}
	parsed, err := parseCertificate(data)
	if err != nil {
		return nil, err
	}
	cert := certificateOf(parsed)
	cert.Key = "file:" + path
	cert.Path = path
	return cert, nil
}

// certFileError shortens the errors of the files: missing or not readable by the agent.
func certFileError(err error) error {
	switch {
	case errors.Is(err, os.ErrNotExist):
		return errors.New("file not found")
	case errors.Is(err, os.ErrPermission):
		return errors.New("permission denied")
	}
	return err
}

// parseCertificate returns the first certificate of PEM data, or of DER data.
func parseCertificate(data []byte) (*x509.Certificate, error) {
	rest := data
	for {
		var block *pem.Block
		block, rest = pem.Decode(rest)
		if block == nil {
			break
		}
		if block.Type == "CERTIFICATE" {
			return x509.ParseCertificate(block.Bytes)
		}
	}
	if bytes.Contains(data, []byte("-----BEGIN")) {
		return nil, errors.New("no certificate in the file")
	}
	cert, err := x509.ParseCertificate(data)
	if err != nil {
		return nil, errors.New("not a PEM or DER certificate")
	}
	return cert, nil
}

// certificateOf describes a parsed certificate.
func certificateOf(cert *x509.Certificate) *system.Certificate {
	sum256 := sha256.Sum256(cert.Raw)
	sum1 := sha1.Sum(cert.Raw)
	names := slices.Clone(cert.DNSNames)
	for _, ip := range cert.IPAddresses {
		names = append(names, ip.String())
	}
	if cert.Subject.CommonName != "" {
		names = append([]string{cert.Subject.CommonName}, names...)
	}
	// without duplicates, in their order
	seen := map[string]bool{}
	names = slices.DeleteFunc(names, func(name string) bool {
		key := strings.ToLower(name)
		defer func() { seen[key] = true }()
		return seen[key]
	})
	return &system.Certificate{
		Subject:     cert.Subject.String(),
		Issuer:      cert.Issuer.String(),
		Names:       names,
		NotBefore:   cert.NotBefore.UTC(),
		NotAfter:    cert.NotAfter.UTC(),
		Fingerprint: hex.EncodeToString(sum256[:]),
		Thumbprint:  strings.ToUpper(hex.EncodeToString(sum1[:])),
		Serial:      fmt.Sprintf("%X", cert.SerialNumber),
		SelfSigned:  bytes.Equal(cert.RawIssuer, cert.RawSubject),
	}
}

// isServerCertificate tells a certificate usable by a server: without
// extended key usage, or with server authentication.
func isServerCertificate(cert *x509.Certificate) bool {
	if len(cert.ExtKeyUsage) == 0 && len(cert.UnknownExtKeyUsage) == 0 {
		return true
	}
	return slices.Contains(cert.ExtKeyUsage, x509.ExtKeyUsageServerAuth) || slices.Contains(cert.ExtKeyUsage, x509.ExtKeyUsageAny)
}

func logCertificateError(source string, err error) {
	if err != nil {
		slog.Debug("Certificates unavailable", "source", source, "err", err)
	}
}
