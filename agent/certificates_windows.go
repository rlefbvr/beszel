//go:build windows

package agent

import (
	"context"
	"crypto/x509"
	"encoding/hex"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"unsafe"

	"github.com/henrygd/beszel/internal/entities/system"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// certStores are the stores of the local machine holding server certificates,
// with the name shown in their path (Cert:\LocalMachine\<name>).
var certStores = []struct{ name, path string }{
	{"MY", "My"},
	{"WebHosting", "WebHosting"},
	{"Remote Desktop", "Remote Desktop"},
}

// iisAppID is the application id of the HTTP.sys bindings of IIS.
const iisAppID = "{4dc3e181-e14b-4a21-b022-59fc669b0914}"

var (
	thumbprintPattern = regexp.MustCompile(`^[0-9a-fA-F]{40}$`)
	guidPattern       = regexp.MustCompile(`^\{[0-9a-fA-F-]{36}\}$`)
	// SITE "Default Web Site" (id:1,bindings:http/*:80:,https/*:443:www.example.com,state:Started)
	appcmdSite = regexp.MustCompile(`^SITE "([^"]+)" \(id:\d+,bindings:([^,]*(?:,[^,]*)*?),state:`)
)

// discoverCertificates finds the certificates of the stores of the local
// machine and where they are bound: IIS and HTTP.sys, Remote Desktop, WinRM.
func discoverCertificates(ctx context.Context, inv *certInventory) {
	uses := map[string][]system.CertificateUse{}
	addUse := func(thumbprint string, use system.CertificateUse) {
		thumbprint = strings.ToUpper(thumbprint)
		uses[thumbprint] = append(uses[thumbprint], use)
	}
	httpSysBindings(ctx, addUse)
	rdpCertificate(addUse)
	winrmListeners(ctx, addUse)

	for _, store := range certStores {
		certs, err := readCertStore(store.name)
		logCertificateError(store.name, err)
		for _, parsed := range certs {
			cert := certificateOf(parsed)
			certUses := uses[cert.Thumbprint]
			if store.name == "Remote Desktop" {
				certUses = append(certUses, system.CertificateUse{Kind: system.CertUseRDP, Location: `Cert:\LocalMachine\Remote Desktop`, Detail: "RDP-Tcp"})
			}
			// the other certificates of the stores: only the server ones
			if len(certUses) == 0 && !isServerCertificate(parsed) {
				continue
			}
			cert.Key = "store:" + store.path + `\` + cert.Thumbprint
			cert.Path = `Cert:\LocalMachine\` + store.path + `\` + cert.Thumbprint
			added := inv.add(cert, nil)
			for i := range certUses {
				inv.add(added, &certUses[i])
			}
		}
	}
}

// readCertStore returns the certificates of a store of the local machine.
func readCertStore(name string) ([]*x509.Certificate, error) {
	storeName, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return nil, err
	}
	store, err := windows.CertOpenStore(windows.CERT_STORE_PROV_SYSTEM, 0, 0,
		windows.CERT_SYSTEM_STORE_LOCAL_MACHINE|windows.CERT_STORE_READONLY_FLAG|windows.CERT_STORE_OPEN_EXISTING_FLAG,
		uintptr(unsafe.Pointer(storeName)))
	if err != nil {
		return nil, err
	}
	defer windows.CertCloseStore(store, 0)
	var certs []*x509.Certificate
	var context *windows.CertContext
	for {
		context, err = windows.CertEnumCertificatesInStore(store, context)
		if context == nil {
			break
		}
		data := unsafe.Slice(context.EncodedCert, context.Length)
		if cert, err := x509.ParseCertificate(append([]byte(nil), data...)); err == nil {
			certs = append(certs, cert)
		}
	}
	return certs, nil
}

// httpSysBindings reads the HTTPS bindings of HTTP.sys, used by IIS and other
// Windows services, with the IIS site of each binding. The labels of netsh are
// translated, so the values are recognized by their form.
func httpSysBindings(ctx context.Context, addUse func(string, system.CertificateUse)) {
	out, err := exec.CommandContext(ctx, "netsh", "http", "show", "sslcert").Output()
	if err != nil {
		logCertificateError("netsh", err)
		return
	}
	sites := iisSites(ctx)
	for _, block := range strings.Split(strings.ReplaceAll(string(out), "\r\n", "\n"), "\n\n") {
		var binding, hash, appID string
		for _, line := range strings.Split(block, "\n") {
			_, value, ok := strings.Cut(line, " : ")
			if !ok {
				continue
			}
			value = strings.TrimSpace(value)
			switch {
			case binding == "":
				binding = value
			case hash == "" && thumbprintPattern.MatchString(value):
				hash = value
			case appID == "" && guidPattern.MatchString(value):
				appID = value
			}
		}
		if hash == "" || binding == "" {
			continue
		}
		if strings.EqualFold(appID, iisAppID) {
			addUse(hash, system.CertificateUse{Kind: system.CertUseIIS, Location: binding, Detail: sites[iisBindingKey(binding)]})
		} else {
			addUse(hash, system.CertificateUse{Kind: system.CertUseHTTPSys, Location: binding, Detail: appID})
		}
	}
}

// iisSites returns the IIS sites by HTTPS binding ("*:443" or "www.example.com:443").
func iisSites(ctx context.Context) map[string]string {
	sites := map[string]string{}
	appcmd := filepath.Join(os.Getenv("windir"), "system32", "inetsrv", "appcmd.exe")
	if _, err := os.Stat(appcmd); err != nil {
		return sites
	}
	out, err := exec.CommandContext(ctx, appcmd, "list", "site").Output()
	if err != nil {
		return sites
	}
	for _, line := range strings.Split(string(out), "\n") {
		m := appcmdSite.FindStringSubmatch(strings.TrimSpace(line))
		if m == nil {
			continue
		}
		for _, binding := range strings.Split(m[2], ",") {
			info, ok := strings.CutPrefix(binding, "https/")
			if !ok {
				continue
			}
			// ip:port:host
			parts := strings.SplitN(info, ":", 3)
			if len(parts) != 3 {
				continue
			}
			key := "*:" + parts[1]
			if parts[2] != "" {
				key = strings.ToLower(parts[2]) + ":" + parts[1]
			}
			sites[key] = m[1]
		}
	}
	return sites
}

// iisBindingKey is the key of iisSites for a netsh binding: 0.0.0.0:443 or www.example.com:443.
func iisBindingKey(binding string) string {
	i := strings.LastIndex(binding, ":")
	if i < 0 {
		return binding
	}
	host, port := binding[:i], binding[i+1:]
	if host == "0.0.0.0" || host == "[::]" || host == "" {
		return "*:" + port
	}
	return strings.ToLower(host) + ":" + port
}

// rdpCertificate reads the certificate chosen for Remote Desktop, when set.
func rdpCertificate(addUse func(string, system.CertificateUse)) {
	const path = `SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp`
	key, err := registry.OpenKey(registry.LOCAL_MACHINE, path, registry.QUERY_VALUE)
	if err != nil {
		return
	}
	defer key.Close()
	hash, _, err := key.GetBinaryValue("SSLCertificateSHA1Hash")
	if err != nil || len(hash) != 20 {
		return
	}
	addUse(hex.EncodeToString(hash), system.CertificateUse{
		Kind:     system.CertUseRDP,
		Location: `HKLM\` + path + `\SSLCertificateSHA1Hash`,
		Detail:   "RDP-Tcp",
	})
}

// winrmListeners reads the certificates of the HTTPS listeners of WinRM.
func winrmListeners(ctx context.Context, addUse func(string, system.CertificateUse)) {
	out, err := exec.CommandContext(ctx, "cmd", "/c", "winrm enumerate winrm/config/listener").Output()
	if err != nil {
		return
	}
	var transport, port, thumbprint string
	flush := func() {
		if strings.EqualFold(transport, "HTTPS") && thumbprintPattern.MatchString(thumbprint) {
			addUse(thumbprint, system.CertificateUse{
				Kind:     system.CertUseWinRM,
				Location: "winrm/config/Listener?Address=*+Transport=HTTPS",
				Detail:   "WinRM " + port,
			})
		}
		transport, port, thumbprint = "", "", ""
	}
	for _, line := range strings.Split(strings.ReplaceAll(string(out), "\r\n", "\n"), "\n") {
		name, value, ok := strings.Cut(strings.TrimSpace(line), " = ")
		switch {
		case strings.TrimSpace(line) == "Listener":
			flush()
		case !ok:
		case name == "Transport":
			transport = value
		case name == "Port":
			port = value
		case name == "CertificateThumbprint":
			thumbprint = value
		}
	}
	flush()
}
