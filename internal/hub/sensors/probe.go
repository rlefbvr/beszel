package sensors

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/henrygd/beszel"
)

const (
	// probeTimeout bounds the probes other than HTTP.
	probeTimeout = 5 * time.Second
	// httpTimeout bounds an HTTP request, redirects included.
	httpTimeout = 15 * time.Second
	// keywordReadLimit is the part of a page searched for the keyword.
	keywordReadLimit = 1 << 20
	// defaultAcceptedCodes are the HTTP status codes of a working page.
	defaultAcceptedCodes = "200-299"
	// defaultDNSName is resolved by the DNS checks without a name.
	defaultDNSName = "example.com"
)

var userAgent = "Beszel/" + beszel.ForkVersion + " (+https://beszel.dev)"

// Check is what a probe checks.
type Check struct {
	Protocol string // icmp, tcp, http, dns or ntp
	Host     string
	Port     int
	// HTTP: address checked, built from the host and port when empty; DNS: name resolved
	URL           string
	Keyword       string
	AcceptedCodes string
	IgnoreTLS     bool
}

// Result is the outcome of one probe.
type Result struct {
	OK bool
	// ResponseUs is the response time in microseconds, for successful probes.
	ResponseUs int64
	// Code is the HTTP status code, 0 without a response.
	Code int
	// Message explains a failure, or the HTTP status.
	Message string
	// CertExpiry is the expiry of the TLS certificate of an HTTPS address.
	CertExpiry time.Time
}

func failed(err error) Result {
	return Result{Message: err.Error()}
}

// Probe runs one check.
func Probe(ctx context.Context, check Check) Result {
	switch check.Protocol {
	case "icmp":
		us, err := probeICMP(ctx, check.Host)
		if err != nil {
			return failed(err)
		}
		return Result{OK: true, ResponseUs: us}
	case "tcp":
		return probeTCP(ctx, check.Host, check.Port)
	case "http":
		return probeHTTP(ctx, check)
	case "dns":
		return probeDNS(ctx, check)
	case "ntp":
		return probeNTP(ctx, check.Host, check.Port)
	default:
		return Result{Message: "unknown protocol " + check.Protocol}
	}
}

// probeTCP measures the time to open a connection to the port.
func probeTCP(ctx context.Context, host string, port int) Result {
	ctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	var dialer net.Dialer
	start := time.Now()
	conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		return failed(err)
	}
	us := time.Since(start).Microseconds()
	conn.Close()
	return Result{OK: true, ResponseUs: us}
}

// httpAddress returns the address of an HTTP check: its URL, or the host and port.
func httpAddress(check Check) string {
	if check.URL != "" {
		return check.URL
	}
	scheme := "http"
	if check.Port == 443 || check.Port == 8443 {
		scheme = "https"
	}
	host := check.Host
	if check.Port != 0 && check.Port != 80 && check.Port != 443 {
		host = net.JoinHostPort(check.Host, strconv.Itoa(check.Port))
	} else if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	return scheme + "://" + host + "/"
}

// probeHTTP requests the page and checks its status code and keyword.
func probeHTTP(ctx context.Context, check Check) Result {
	ctx, cancel := context.WithTimeout(ctx, httpTimeout)
	defer cancel()
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: check.IgnoreTLS} //nolint:gosec // chosen by the user
	transport.DisableKeepAlives = true
	client := &http.Client{Transport: transport}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, httpAddress(check), nil)
	if err != nil {
		return failed(err)
	}
	req.Header.Set("User-Agent", userAgent)
	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return failed(err)
	}
	defer resp.Body.Close()
	us := time.Since(start).Microseconds()

	result := Result{Code: resp.StatusCode, Message: resp.Status, ResponseUs: us}
	if resp.TLS != nil && len(resp.TLS.PeerCertificates) > 0 {
		result.CertExpiry = resp.TLS.PeerCertificates[0].NotAfter
	}
	accepted := check.AcceptedCodes
	if strings.TrimSpace(accepted) == "" {
		accepted = defaultAcceptedCodes
	}
	if !codeAccepted(resp.StatusCode, accepted) {
		return result
	}
	if keyword := strings.TrimSpace(check.Keyword); keyword != "" {
		body, err := io.ReadAll(io.LimitReader(resp.Body, keywordReadLimit))
		if err != nil {
			result.Message = err.Error()
			return result
		}
		if !strings.Contains(string(body), keyword) {
			result.Message = fmt.Sprintf("keyword %q not found", keyword)
			return result
		}
	}
	result.OK = true
	return result
}

// codeAccepted reports whether a status code is in a list such as "200-299,401".
func codeAccepted(code int, accepted string) bool {
	for part := range strings.SplitSeq(accepted, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		low, high, isRange := strings.Cut(part, "-")
		from, err := strconv.Atoi(strings.TrimSpace(low))
		if err != nil {
			continue
		}
		to := from
		if isRange {
			if to, err = strconv.Atoi(strings.TrimSpace(high)); err != nil {
				continue
			}
		}
		if code >= from && code <= to {
			return true
		}
	}
	return false
}

// probeDNS asks the DNS server of the check to resolve a name.
func probeDNS(ctx context.Context, check Check) Result {
	ctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	port := check.Port
	if port == 0 {
		port = 53
	}
	server := net.JoinHostPort(check.Host, strconv.Itoa(port))
	resolver := &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, _, _ string) (net.Conn, error) {
			var dialer net.Dialer
			return dialer.DialContext(ctx, "udp", server)
		},
	}
	name := strings.TrimSpace(check.URL)
	if name == "" {
		name = defaultDNSName
	}
	start := time.Now()
	addresses, err := resolver.LookupHost(ctx, name)
	if err != nil {
		return failed(err)
	}
	if len(addresses) == 0 {
		return failed(errors.New("no address resolved"))
	}
	return Result{OK: true, ResponseUs: time.Since(start).Microseconds()}
}

// probeNTP sends a client request (RFC 5905) and waits for a server answer.
func probeNTP(ctx context.Context, host string, port int) Result {
	ctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	if port == 0 {
		port = 123
	}
	var dialer net.Dialer
	conn, err := dialer.DialContext(ctx, "udp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		return failed(err)
	}
	defer conn.Close()
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}
	request := make([]byte, 48)
	request[0] = 0x23 // leap indicator 0, version 4, client mode
	start := time.Now()
	if _, err := conn.Write(request); err != nil {
		return failed(err)
	}
	response := make([]byte, 48)
	n, err := conn.Read(response)
	if err != nil {
		return failed(err)
	}
	if n < 48 || response[0]&0x7 != 4 {
		return failed(errors.New("invalid NTP answer"))
	}
	// a stratum of 0 is a "kiss of death" answer: the server refuses to answer
	if response[1] == 0 {
		return failed(fmt.Errorf("NTP server refused (%s)", string(response[12:16])))
	}
	return Result{OK: true, ResponseUs: time.Since(start).Microseconds()}
}
