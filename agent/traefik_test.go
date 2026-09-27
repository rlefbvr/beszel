//go:build testing

package agent

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
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

func TestIsTraefikImage(t *testing.T) {
	for image, want := range map[string]bool{
		"traefik":                         true,
		"traefik:v3.1":                    true,
		"docker.io/library/traefik:v2.11": true,
		"traefik@sha256:abc":              true,
		"traefik/whoami":                  false,
		"nginx:latest":                    false,
	} {
		assert.Equal(t, want, isTraefikImage(image), image)
	}
	assert.Equal(t, "v3.1", imageVersion("traefik:v3.1"))
	assert.Equal(t, "", imageVersion("registry:5000/traefik"))
}

func TestTraefikRoutes(t *testing.T) {
	routes := traefikRoutes(map[string]string{
		"enable":                                     "true",
		"http.routers.app.rule":                      "Host(`app.example.com`) || Host(`www.example.com`)",
		"http.routers.app.entrypoints":               "websecure",
		"http.routers.app.tls.certresolver":          "le",
		"http.routers.dashboard.rule":                "Host(`traefik.example.com`) && PathPrefix(`/dashboard`)",
		"http.routers.dashboard.service":             "api@internal",
		"http.routers.dashboard.tls":                 "true",
		"http.routers.noRule.service":                "other",
		"http.services.app.loadbalancer.server.port": "80",
	}, "app", "docker")
	require.Len(t, routes, 2)
	byName := map[string]system.TraefikRoute{}
	for _, route := range routes {
		byName[route.Router] = route
	}
	app := byName["app"]
	assert.Equal(t, []string{"app.example.com", "www.example.com"}, app.Hosts)
	assert.True(t, app.TLS)
	assert.Equal(t, "le", app.Resolver)
	assert.Equal(t, []string{"websecure"}, app.EntryPoints)
	assert.Equal(t, "app", app.Container)
	assert.Equal(t, "api@internal", byName["dashboard"].Service)
}

func TestTraefikSettingsAndPaths(t *testing.T) {
	dir := t.TempDir()
	config := filepath.Join(dir, "traefik.yml")
	require.NoError(t, os.WriteFile(config, []byte(`
api:
  dashboard: true
accessLog:
  filePath: /logs/access.log
certificatesResolvers:
  le:
    acme:
      storage: /letsencrypt/acme.json
providers:
  docker: {}
`), 0o600))

	src := &traefikSource{
		instance: system.TraefikInstance{Id: "abc", Name: "traefik"},
		settings: map[string]string{},
		mounts: []traefikMount{
			{Source: dir, Destination: "/etc/traefik"},
			{Source: filepath.Join(dir, "logs"), Destination: "/logs"},
			{Source: filepath.Join(dir, "le"), Destination: "/letsencrypt"},
		},
	}
	require.NoError(t, readYAMLSettings(src.hostPath("/etc/traefik/traefik.yml"), "", src.settings))
	for key, value := range traefikArgs([]string{"--api.insecure", "--log.level=DEBUG", "notAFlag"}) {
		src.settings[key] = value
	}
	assert.Equal(t, "true", src.settings["api.insecure"])
	assert.Equal(t, "DEBUG", src.settings["log.level"])
	assert.True(t, hasSection(src.settings, "accesslog"))
	assert.True(t, hasSection(src.settings, "providers.docker"))
	assert.False(t, hasSection(src.settings, "metrics"))
	assert.Equal(t, "", src.hostPath("/not/mounted"))

	// an acme.json with a certificate of the resolver
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "le"), 0o700))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "le", "acme.json"), []byte(`{"le":{"Certificates":[{"domain":{"main":"app.example.com"},"certificate":"`+base64.StdEncoding.EncodeToString(testCertificatePEM(t, "app.example.com"))+`","key":"x"}]}}`), 0o600))

	src.describe(nil)
	assert.Equal(t, "file:"+filepath.Join(dir, "logs", "access.log"), src.instance.AccessLog)
	assert.Equal(t, "stdout", src.instance.Log)
	require.Len(t, src.instance.Resolvers, 1)
	assert.Equal(t, 1, src.instance.Resolvers[0].Certificates)
	assert.Empty(t, src.instance.Resolvers[0].Error)

	storage, err := readAcmeStorage(src.instance.Resolvers[0].Storage)
	require.NoError(t, err)
	pemData, err := base64.StdEncoding.DecodeString(storage["le"][0].Certificate)
	require.NoError(t, err)
	parsed, err := parseCertificate(pemData)
	require.NoError(t, err)
	assert.Equal(t, "app.example.com", parsed.Subject.CommonName)
}

func TestIsAccessLine(t *testing.T) {
	assert.True(t, isAccessLine(`10.0.0.1 - - [27/Sep/2026:10:00:00 +0000] "GET / HTTP/2.0" 200 12`))
	assert.True(t, isAccessLine(`{"RequestMethod":"GET","DownstreamStatus":200}`))
	assert.False(t, isAccessLine(`time="2026-09-27T10:00:00Z" level=info msg="Configuration loaded"`))
}

func TestTailFile(t *testing.T) {
	file := filepath.Join(t.TempDir(), "access.log")
	require.NoError(t, os.WriteFile(file, []byte("a\nb\nc\n"), 0o600))
	lines, err := tailFile(file)
	require.NoError(t, err)
	assert.Equal(t, "a\nb\nc", lines)
}

func testCertificatePEM(t *testing.T, name string) []byte {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: name},
		DNSNames:     []string{name},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(90 * 24 * time.Hour),
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	require.NoError(t, err)
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
}
