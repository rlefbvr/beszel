//go:build testing

package agent

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/henrygd/beszel/internal/entities/system"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// writeTestCertificate writes a self-signed certificate for names to a PEM file.
func writeTestCertificate(t *testing.T, path string, names ...string) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	template := &x509.Certificate{
		SerialNumber: big.NewInt(42),
		Subject:      pkix.Name{CommonName: names[0]},
		DNSNames:     names,
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(30 * 24 * time.Hour),
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o600))
}

func TestReadCertificateFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "site.pem")
	writeTestCertificate(t, path, "www.example.com", "example.com", "WWW.example.com")

	cert, err := readCertificateFile(path)
	require.NoError(t, err)
	assert.Equal(t, "file:"+path, cert.Key)
	assert.Equal(t, []string{"www.example.com", "example.com"}, cert.Names, "common name first, without duplicates")
	assert.True(t, cert.SelfSigned)
	assert.Len(t, cert.Fingerprint, 64)
	assert.Len(t, cert.Thumbprint, 40)
	assert.Equal(t, "2A", cert.Serial)

	_, err = readCertificateFile(filepath.Join(dir, "missing.pem"))
	assert.EqualError(t, err, "file not found")
	require.NoError(t, os.WriteFile(filepath.Join(dir, "key.pem"), []byte("-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n"), 0o600))
	_, err = readCertificateFile(filepath.Join(dir, "key.pem"))
	assert.EqualError(t, err, "no certificate in the file")
}

// The same certificate found in several places is one certificate with all
// its uses; a file added by a user stays on its own.
func TestCertInventoryMergesUses(t *testing.T) {
	dir := t.TempDir()
	cert := filepath.Join(dir, "cert.pem")
	writeTestCertificate(t, cert, "www.example.com")
	data, err := os.ReadFile(cert)
	require.NoError(t, err)
	chain := filepath.Join(dir, "fullchain.pem")
	require.NoError(t, os.WriteFile(chain, data, 0o600))

	inv := newCertInventory()
	inv.addFile(cert, system.CertificateUse{Kind: system.CertUseLetsEncrypt, Location: "renewal.conf"})
	inv.addFile(chain, system.CertificateUse{Kind: system.CertUseNginx, Location: "site.conf:12"})
	inv.addFile(chain, system.CertificateUse{Kind: system.CertUseNginx, Location: "site.conf:12"})
	inv.addCustomFile(chain)
	inv.addFile(filepath.Join(dir, "gone.pem"), system.CertificateUse{Kind: system.CertUseApache})

	list := inv.list()
	require.Len(t, list, 3)
	assert.Equal(t, "file:"+cert, list[0].Key)
	assert.Equal(t, []system.CertificateUse{
		{Kind: system.CertUseLetsEncrypt, Location: "renewal.conf"},
		{Kind: system.CertUseNginx, Location: "site.conf:12"},
	}, list[0].Uses)
	assert.True(t, list[1].Custom)
	assert.Equal(t, "custom:"+chain, list[1].Key)
	assert.Equal(t, "file not found", list[2].Error)
}
