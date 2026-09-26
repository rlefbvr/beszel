//go:build !windows

package agent

import (
	"bufio"
	"context"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/henrygd/beszel/internal/entities/system"
)

// certConfig describes where a service configures its certificates.
type certConfig struct {
	kind string
	// files are glob patterns of the configuration files
	files []string
	// directive matches a certificate line, the path in its first group
	directive *regexp.Regexp
	// name matches the server name line, the name in its first group
	name *regexp.Regexp
	// root resolves the relative paths
	root string
}

var certConfigs = []certConfig{
	{
		kind: system.CertUseNginx,
		files: []string{
			"/etc/nginx/nginx.conf", "/etc/nginx/conf.d/*.conf", "/etc/nginx/sites-enabled/*", "/etc/nginx/http.d/*.conf",
			"/usr/local/etc/nginx/nginx.conf", "/usr/local/etc/nginx/conf.d/*.conf", "/usr/local/etc/nginx/sites-enabled/*",
		},
		directive: regexp.MustCompile(`^\s*ssl_certificate\s+["']?([^;"'\s]+)`),
		name:      regexp.MustCompile(`^\s*server_name\s+([^;]+);`),
		root:      "/etc/nginx",
	},
	{
		kind: system.CertUseApache,
		files: []string{
			"/etc/apache2/apache2.conf", "/etc/apache2/sites-enabled/*", "/etc/apache2/conf-enabled/*",
			"/etc/httpd/conf/httpd.conf", "/etc/httpd/conf.d/*.conf", "/usr/local/etc/apache24/httpd.conf",
			"/usr/local/etc/apache24/extra/*.conf", "/usr/local/etc/apache24/Includes/*.conf",
		},
		directive: regexp.MustCompile(`(?i)^\s*SSLCertificateFile\s+["']?([^"'\s]+)`),
		name:      regexp.MustCompile(`(?i)^\s*ServerName\s+(\S+)`),
		root:      "/etc/apache2",
	},
	{
		kind:      system.CertUsePostfix,
		files:     []string{"/etc/postfix/main.cf", "/usr/local/etc/postfix/main.cf"},
		directive: regexp.MustCompile(`^\s*smtpd_tls_cert_file\s*=\s*(\S+)`),
		name:      regexp.MustCompile(`^\s*myhostname\s*=\s*(\S+)`),
	},
	{
		kind:      system.CertUseDovecot,
		files:     []string{"/etc/dovecot/dovecot.conf", "/etc/dovecot/conf.d/*.conf", "/usr/local/etc/dovecot/conf.d/*.conf"},
		directive: regexp.MustCompile(`^\s*ssl_cert\s*=\s*<?\s*(\S+)`),
	},
}

// haproxyCrt matches the certificates of a bind line of HAProxy.
var haproxyCrt = regexp.MustCompile(`\scrt\s+(\S+)`)

// discoverCertificates finds the certificates configured in the services of the host.
func discoverCertificates(ctx context.Context, inv *certInventory) {
	discoverLetsEncrypt(inv)
	for _, config := range certConfigs {
		for _, pattern := range config.files {
			files, _ := filepath.Glob(pattern)
			for _, file := range files {
				if ctx.Err() != nil {
					return
				}
				scanCertConfig(inv, config, file)
			}
		}
	}
	scanHAProxy(inv, "/etc/haproxy/haproxy.cfg")
	scanHAProxy(inv, "/usr/local/etc/haproxy.conf")
	discoverFixedCertificates(inv)
}

// discoverLetsEncrypt finds the certificates renewed by certbot, and the renewal configuration of each.
func discoverLetsEncrypt(inv *certInventory) {
	for _, base := range []string{"/etc/letsencrypt", "/usr/local/etc/letsencrypt"} {
		dirs, err := os.ReadDir(filepath.Join(base, "live"))
		if err != nil {
			continue
		}
		for _, dir := range dirs {
			if !dir.IsDir() {
				continue
			}
			name := dir.Name()
			inv.addFile(filepath.Join(base, "live", name, "cert.pem"), system.CertificateUse{
				Kind:     system.CertUseLetsEncrypt,
				Location: filepath.Join(base, "renewal", name+".conf"),
				Detail:   name,
			})
		}
	}
}

// discoverFixedCertificates finds the certificates of the services using fixed files.
func discoverFixedCertificates(inv *certInventory) {
	// Proxmox VE: the uploaded certificate replaces the one of the node
	proxmox := "/etc/pve/local/pveproxy-ssl.pem"
	if _, err := os.Stat(proxmox); err != nil {
		proxmox = "/etc/pve/local/pve-ssl.pem"
	}
	if _, err := os.Stat(proxmox); err == nil {
		inv.addFile(proxmox, system.CertificateUse{Kind: system.CertUseProxmox, Location: proxmox, Detail: "pveproxy"})
	}
	// Cockpit: the last certificate of the directory in alphabetical order
	files, _ := filepath.Glob("/etc/cockpit/ws-certs.d/*.cert")
	crt, _ := filepath.Glob("/etc/cockpit/ws-certs.d/*.crt")
	files = append(files, crt...)
	for _, file := range files {
		inv.addFile(file, system.CertificateUse{Kind: system.CertUseCockpit, Location: file, Detail: "cockpit"})
	}
}

// scanCertConfig finds the certificates of a configuration file, with the
// server name closest to each.
func scanCertConfig(inv *certInventory, config certConfig, file string) {
	type found struct {
		path string
		line int
	}
	var certs []found
	type name struct {
		value string
		line  int
	}
	var names []name
	readConfigLines(file, func(number int, line string) {
		if strings.HasPrefix(strings.TrimSpace(line), "#") {
			return
		}
		if m := config.directive.FindStringSubmatch(line); m != nil && !strings.Contains(m[1], "$") {
			certs = append(certs, found{path: m[1], line: number})
		}
		if config.name != nil {
			if m := config.name.FindStringSubmatch(line); m != nil {
				names = append(names, name{value: strings.Fields(m[1])[0], line: number})
			}
		}
	})
	root := config.root
	if config.kind == system.CertUseApache && strings.HasPrefix(file, "/etc/httpd") {
		root = "/etc/httpd"
	}
	for _, cert := range certs {
		path := cert.path
		if !filepath.IsAbs(path) && root != "" {
			path = filepath.Join(root, path)
		}
		// the server name before the certificate, or else the first after it
		detail, distance := "", -1
		for _, n := range names {
			d := cert.line - n.line
			if d < 0 {
				d = -d + 1000
			}
			if distance < 0 || d < distance {
				detail, distance = n.value, d
			}
		}
		inv.addFile(path, system.CertificateUse{
			Kind:     config.kind,
			Location: file + ":" + strconv.Itoa(cert.line),
			Detail:   detail,
		})
	}
}

// scanHAProxy finds the certificates of the bind lines of HAProxy: files, or
// directories of certificates.
func scanHAProxy(inv *certInventory, file string) {
	readConfigLines(file, func(number int, line string) {
		trimmed := strings.TrimSpace(line)
		if !strings.HasPrefix(trimmed, "bind ") {
			return
		}
		detail := strings.Fields(trimmed)[1]
		for _, m := range haproxyCrt.FindAllStringSubmatch(line, -1) {
			use := system.CertificateUse{Kind: system.CertUseHAProxy, Location: file + ":" + strconv.Itoa(number), Detail: detail}
			if info, err := os.Stat(m[1]); err == nil && info.IsDir() {
				entries, _ := os.ReadDir(m[1])
				for _, entry := range entries {
					if !entry.IsDir() && !strings.HasSuffix(entry.Name(), ".key") {
						inv.addFile(filepath.Join(m[1], entry.Name()), use)
					}
				}
				continue
			}
			inv.addFile(m[1], use)
		}
	})
}

// readConfigLines calls fn with each line of a file and its number.
func readConfigLines(file string, fn func(number int, line string)) {
	f, err := os.Open(file)
	if err != nil {
		return
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)
	number := 0
	for scanner.Scan() {
		number++
		fn(number, scanner.Text())
	}
}
