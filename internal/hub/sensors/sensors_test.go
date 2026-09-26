//go:build testing

package sensors

import (
	"context"
	"encoding/binary"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/henrygd/beszel/internal/alerts"
	_ "github.com/henrygd/beszel/internal/migrations"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCodeAccepted(t *testing.T) {
	assert.True(t, codeAccepted(200, "200-299"))
	assert.True(t, codeAccepted(401, "200-299, 401"))
	assert.False(t, codeAccepted(302, "200-299,401"))
	assert.False(t, codeAccepted(500, "garbage"))
}

func TestHTTPAddress(t *testing.T) {
	assert.Equal(t, "https://example.com/", httpAddress(Check{Host: "example.com", Port: 443}))
	assert.Equal(t, "http://example.com/", httpAddress(Check{Host: "example.com", Port: 80}))
	assert.Equal(t, "http://10.0.0.1:8080/", httpAddress(Check{Host: "10.0.0.1", Port: 8080}))
	assert.Equal(t, "https://pve.lan:8006/", httpAddress(Check{Host: "pve.lan", Port: 8006}), "Proxmox answers in HTTPS")
	assert.Equal(t, "http://[::1]/", httpAddress(Check{Host: "::1"}))
	assert.Equal(t, "https://site/status", httpAddress(Check{Host: "ignored", URL: "https://site/status"}))
}

func TestProbeHTTP(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/broken" {
			http.Error(w, "boom", http.StatusInternalServerError)
			return
		}
		fmt.Fprint(w, "status: all systems operational")
	}))
	defer server.Close()
	ctx := context.Background()

	result := Probe(ctx, Check{Protocol: "http", URL: server.URL, Keyword: "operational"})
	assert.True(t, result.OK)
	assert.Equal(t, 200, result.Code)
	assert.Positive(t, result.ResponseUs)

	result = Probe(ctx, Check{Protocol: "http", URL: server.URL, Keyword: "degraded"})
	assert.False(t, result.OK, "the keyword is missing")
	assert.Contains(t, result.Message, "degraded")

	result = Probe(ctx, Check{Protocol: "http", URL: server.URL + "/broken"})
	assert.False(t, result.OK)
	assert.Equal(t, 500, result.Code)
	assert.Equal(t, "500 Internal Server Error", result.Message)

	result = Probe(ctx, Check{Protocol: "http", URL: server.URL + "/broken", AcceptedCodes: "200-299,500"})
	assert.True(t, result.OK, "500 is accepted")
}

func TestProbeTCP(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	port := listener.Addr().(*net.TCPAddr).Port
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			conn.Close()
		}
	}()
	assert.True(t, Probe(context.Background(), Check{Protocol: "tcp", Host: "127.0.0.1", Port: port}).OK)
	listener.Close()
	assert.False(t, Probe(context.Background(), Check{Protocol: "tcp", Host: "127.0.0.1", Port: port}).OK, "closed port")
}

func TestProbeNTP(t *testing.T) {
	conn, err := net.ListenPacket("udp", "127.0.0.1:0")
	require.NoError(t, err)
	defer conn.Close()
	go func() {
		buf := make([]byte, 48)
		for {
			_, addr, err := conn.ReadFrom(buf)
			if err != nil {
				return
			}
			reply := make([]byte, 48)
			reply[0] = 0x24 // version 4, server mode
			reply[1] = 2    // stratum
			conn.WriteTo(reply, addr)
		}
	}()
	port := conn.LocalAddr().(*net.UDPAddr).Port
	assert.True(t, Probe(context.Background(), Check{Protocol: "ntp", Host: "127.0.0.1", Port: port}).OK)
}

// testApp is a PocketBase test app with the hub links.
type testApp struct {
	*tests.TestApp
}

func (testApp) MakeLink(parts ...string) string {
	return "http://hub/" + strings.Join(parts, "/")
}

// sentAlerts records the alerts instead of sending them.
type sentAlerts []alerts.AlertMessageData

func (s *sentAlerts) SendAlert(data alerts.AlertMessageData) error {
	*s = append(*s, data)
	return nil
}

func newTestManager(t *testing.T) (*Manager, *sentAlerts, testApp) {
	app, err := tests.NewTestApp(t.TempDir())
	require.NoError(t, err)
	t.Cleanup(app.Cleanup)
	sent := &sentAlerts{}
	m := NewManager(testApp{app}, sent)
	m.ctx, m.cancel = context.WithCancel(context.Background())
	t.Cleanup(m.Stop)
	return m, sent, testApp{app}
}

func createRecord(t *testing.T, app core.App, collection string, data map[string]any) *core.Record {
	c, err := app.FindCollectionByNameOrId(collection)
	require.NoError(t, err)
	record := core.NewRecord(c)
	record.Load(data)
	require.NoError(t, app.Save(record))
	return record
}

func TestDownAfterRetriesWithIncident(t *testing.T) {
	m, sent, app := newTestManager(t)
	sensorRecord := createRecord(t, app, "sensors", map[string]any{"name": "NAS", "host": "192.0.2.10", "interval": 60, "retries": 1, "paused": true})
	checkRecord := createRecord(t, app, "sensor_checks", map[string]any{"sensor": sensorRecord.Id, "protocol": "http", "port": 80, "label": "Web"})
	user := createRecord(t, app, "users", map[string]any{"email": "user@example.com", "password": "testtesttest", "passwordConfirm": "testtesttest"})
	createRecord(t, app, "sensor_alerts", map[string]any{"user": user.Id, "sensor": sensorRecord.Id, "name": "down", "min": 0})

	// paused: loaded without probes, then driven by hand
	m.reload(sensorRecord.Id)
	s := m.sensors[sensorRecord.Id]
	require.NotNil(t, s)
	s.paused = false
	c := s.checks[0]
	start := time.Now().UTC()
	failure := Result{Code: 503, Message: "503 Service Unavailable"}

	m.applyResult(s, c, failure, start)
	assert.Equal(t, "pending", c.status, "one failure is tolerated (retries = 1)")
	m.applyResult(s, c, failure, start.Add(time.Minute))
	assert.Equal(t, "down", c.status)

	incident, err := app.FindFirstRecordByFilter("sensor_incidents", "check={:check}", dbx.Params{"check": checkRecord.Id})
	require.NoError(t, err)
	assert.WithinDuration(t, start, incident.GetDateTime("start").Time(), time.Millisecond, "the interruption starts at the first failure")
	assert.Equal(t, 503, incident.GetInt("code"))
	assert.Empty(t, incident.GetString("end"))

	m.flush(start.Add(2 * time.Minute))
	require.Len(t, *sent, 1, "down alert sent")
	assert.Equal(t, "sensor.down.title", (*sent)[0].Title.Key)
	assert.Equal(t, "Web", (*sent)[0].Message.Args["checks"])
	stored, _ := app.FindRecordById("sensors", sensorRecord.Id)
	assert.Equal(t, "down", stored.GetString("status"))
	assert.Equal(t, "bad", stored.GetString("quality"))

	m.applyResult(s, c, Result{OK: true, ResponseUs: 12_000, Code: 200}, start.Add(3*time.Minute))
	assert.Equal(t, "up", c.status)
	incident, _ = app.FindRecordById("sensor_incidents", incident.Id)
	assert.NotEmpty(t, incident.GetString("end"), "the interruption ends at the first success")

	m.flush(start.Add(4 * time.Minute))
	require.Len(t, *sent, 2)
	assert.Equal(t, "sensor.up.title", (*sent)[1].Title.Key)
	assert.Equal(t, alerts.AlertStatusResolved, (*sent)[1].Status)

	var stats []*core.Record
	stats, err = app.FindAllRecords("sensor_stats", dbx.HashExp{"check": checkRecord.Id, "type": "1m"})
	require.NoError(t, err)
	var total, success int
	for _, r := range stats {
		total += r.GetInt("total_count")
		success += r.GetInt("success_count")
	}
	assert.Equal(t, 3, total)
	assert.Equal(t, 1, success)
}

func TestQuality(t *testing.T) {
	now := time.Now()
	s := &sensor{latencyThreshold: 100}
	c := &checkState{status: "up"}
	s.checks = []*checkState{c}
	for i := range 50 {
		c.recent = append(c.recent, sample{at: now, ok: i != 0, us: 20_000})
	}
	s.summarize(now)
	assert.Equal(t, "degraded", s.quality, "2% loss")
	assert.Equal(t, 2.0, s.loss)
	assert.Equal(t, 20.0, s.res)

	c.recent = c.recent[1:]
	s.summarize(now)
	assert.Equal(t, "good", s.quality)

	s.latencyThreshold = 10
	s.summarize(now)
	assert.Equal(t, "degraded", s.quality, "slower than the threshold")

	c.recent = append([]sample{{at: now.Add(-11 * time.Minute)}}, c.recent...)
	s.summarize(now)
	assert.Equal(t, 0.0, s.loss, "failures older than the window don't count")
	assert.Len(t, c.recent, 49)
}

func TestQualityAndPortAlerts(t *testing.T) {
	now := time.Now()
	ssh := &checkState{id: "ssh", label: "SSH", check: Check{Protocol: "tcp", Port: 22}, status: "down"}
	web := &checkState{id: "web", check: Check{Protocol: "http", Port: 443}, status: "up"}
	s := &sensor{name: "srv", host: "10.0.0.1", status: "down", quality: "bad", hasRecentSamples: true, checks: []*checkState{ssh, web}}

	port := s.alertCondition("port", 0, []string{"ssh", "web"}, now)
	assert.True(t, port.active, "a chosen port is down")
	assert.Equal(t, "SSH, HTTP 443", port.subject)
	assert.Equal(t, "SSH", port.title.Args["checks"], "the title names the ports down")
	assert.False(t, s.alertCondition("port", 0, []string{"web"}, now).active, "only the chosen ports count")

	s.status, s.quality = "up", "degraded"
	assert.True(t, s.alertCondition("quality", 1, nil, now).active, "degraded or bad")
	assert.False(t, s.alertCondition("quality", 2, nil, now).active, "bad only")
	s.quality = "bad"
	assert.True(t, s.alertCondition("quality", 2, nil, now).active)
	s.hasRecentSamples = false
	assert.False(t, s.alertCondition("quality", 1, nil, now).active, "no samples, no alert")
}

func TestHeartbeat(t *testing.T) {
	now := time.Date(2026, 9, 25, 12, 0, 20, 0, time.UTC)
	latest := now.Add(-5 * time.Second)
	// rounds of two checks every 15 s, with a few milliseconds of jitter
	s := &sensor{id: "s1", beats: []sample{
		{at: now.Add(-2 * time.Hour), ok: true}, // outside the hour
		{at: latest.Add(-30*time.Second - 20*time.Millisecond), ok: false},
		{at: latest.Add(-30*time.Second - 20*time.Millisecond), ok: true},
		{at: latest.Add(-15*time.Second + 30*time.Millisecond), ok: true},
		{at: latest.Add(-15*time.Second + 30*time.Millisecond), ok: true},
		{at: latest, ok: true},
		{at: latest, ok: true},
	}}
	m := &Manager{sensors: map[string]*sensor{"s1": s}}

	beats, ok := m.Heartbeat("s1", 15*time.Second, time.Hour, now)
	require.True(t, ok)
	require.Len(t, beats, 240)
	last := beats[len(beats)-1]
	assert.Equal(t, latest.UnixMilli(), last.Time, "the last period is the latest round")
	assert.Equal(t, Beat{Time: last.Time, Total: 2, Success: 2}, last, "the last bar always holds the latest round")
	// one round per period, despite the jitter
	assert.Equal(t, Beat{Time: latest.Add(-15 * time.Second).UnixMilli(), Total: 2, Success: 2}, beats[len(beats)-2])
	assert.Equal(t, Beat{Time: latest.Add(-30 * time.Second).UnixMilli(), Total: 2, Success: 1}, beats[len(beats)-3])
	assert.Equal(t, 0, beats[len(beats)-4].Total)
	total := 0
	for _, beat := range beats {
		total += beat.Total
	}
	assert.Equal(t, 6, total, "probes older than an hour are ignored")

	// without a recent probe, the periods end now and the gap shows
	stale, _ := m.Heartbeat("s1", 15*time.Second, time.Hour, now.Add(time.Minute))
	assert.Equal(t, 0, stale[len(stale)-1].Total)

	half, _ := m.Heartbeat("s1", 10*time.Second, 30*time.Minute, now)
	assert.Len(t, half, 180, "half an hour of 10 s periods")

	// every sensor at once, one period per interval of the sensor
	s.interval = 15 * time.Second
	all := m.Heartbeats(30, now)
	require.Len(t, all["s1"], 30)
	assert.Equal(t, beats[len(beats)-3:], all["s1"][27:], "the same periods as the page of the sensor")

	_, ok = m.Heartbeat("unknown", 15*time.Second, time.Hour, now)
	assert.False(t, ok)
}

func TestCertInfo(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer server.Close()
	host, port, _ := net.SplitHostPort(strings.TrimPrefix(server.URL, "https://"))
	portNumber, _ := strconv.Atoi(port)

	result := Probe(context.Background(), Check{Protocol: "http", Host: host, Port: portNumber, URL: server.URL, IgnoreTLS: true})
	require.True(t, result.OK, result.Message)
	require.NotNil(t, result.Cert)
	cert := result.Cert
	assert.Equal(t, cert.NotAfter, result.CertExpiry.UTC())
	assert.NotEmpty(t, cert.Issuer)
	assert.Contains(t, cert.Names, "127.0.0.1")
	assert.Len(t, strings.Split(cert.SHA256, ":"), 32, "SHA-256 fingerprint as 32 bytes")
	assert.NotEmpty(t, cert.PublicKey)
	assert.True(t, strings.HasPrefix(cert.TLSVersion, "TLS"), cert.TLSVersion)
	assert.False(t, cert.Trusted, "the test certificate is not trusted by the system roots")
	assert.NotEmpty(t, cert.TrustError)
}

func TestAddSystemSensor(t *testing.T) {
	m, _, app := newTestManager(t)
	user := createRecord(t, app, "users", map[string]any{"email": "owner@example.com", "password": "testtesttest", "passwordConfirm": "testtesttest"})
	newSystem := func(name, host string) *core.Record {
		return createRecord(t, app, "systems", map[string]any{"name": name, "host": host, "port": "45876", "users": []string{user.Id}, "group": "Prod"})
	}

	require.NoError(t, m.addSystemSensor(newSystem("web-01", "10.0.0.5")))
	count, err := app.CountRecords("sensors", dbx.HashExp{"host": "10.0.0.5"})
	require.NoError(t, err)
	assert.EqualValues(t, 1, count, "one sensor, even if called again")
	sensor, err := app.FindFirstRecordByFilter("sensors", "host = '10.0.0.5'")
	require.NoError(t, err)
	assert.Equal(t, "web-01", sensor.GetString("name"))
	assert.Equal(t, "Prod", sensor.GetString("group"))
	checks, err := app.FindAllRecords("sensor_checks", dbx.HashExp{"sensor": sensor.Id})
	require.NoError(t, err)
	require.Len(t, checks, 1)
	assert.Equal(t, "icmp", checks[0].GetString("protocol"))

	// the host already has a sensor, compared without case
	createRecord(t, app, "sensors", map[string]any{"name": "NAS", "host": "NAS.lan", "interval": 60})
	require.NoError(t, m.addSystemSensor(newSystem("nas", "nas.lan")))
	count, err = app.CountRecords("sensors", dbx.NewExp("lower(host) = 'nas.lan'"))
	require.NoError(t, err)
	assert.EqualValues(t, 1, count, "no second sensor for the same host")

	// no address to ping
	require.NoError(t, m.addSystemSensor(newSystem("local", "/var/run/beszel.sock")))
	count, _ = app.CountRecords("sensors", dbx.HashExp{"host": "/var/run/beszel.sock"})
	assert.EqualValues(t, 0, count)
}

func TestHeartbeatSurvivesRestart(t *testing.T) {
	m, _, app := newTestManager(t)
	record := createRecord(t, app, "sensors", map[string]any{"name": "NAS", "host": "192.0.2.20", "interval": 60, "paused": true})
	now := time.Now().UTC().Truncate(time.Millisecond)
	beats := []sample{
		{at: now.Add(-2 * time.Hour), ok: true}, // too old, not restored
		{at: now.Add(-time.Minute), ok: true},
		{at: now.Add(-time.Minute), ok: false},
		{at: now, ok: true},
		{at: now, ok: true},
	}
	rounds := packBeats(beats)
	require.Len(t, rounds, 3)
	assert.Equal(t, round{Time: now.Add(-time.Minute).UnixMilli(), Total: 2, Success: 1}, rounds[1])
	m.saveBeats(record.Id, rounds)
	m.saveBeats(record.Id, rounds) // updates the same record
	count, err := app.CountRecords(heartbeatCollection)
	require.NoError(t, err)
	assert.EqualValues(t, 1, count)

	// a restarted hub reads them back
	m.reload(record.Id)
	restored := m.sensors[record.Id].beats
	require.Len(t, restored, 4)
	heartbeat, _ := m.Heartbeat(record.Id, time.Minute, time.Hour, now)
	assert.Equal(t, Beat{Time: now.UnixMilli(), Total: 2, Success: 2}, heartbeat[len(heartbeat)-1])
	assert.Equal(t, Beat{Time: now.Add(-time.Minute).UnixMilli(), Total: 2, Success: 1}, heartbeat[len(heartbeat)-2])
}

func TestParseTracerouteOutput(t *testing.T) {
	linux := []byte("traceroute to 1.1.1.1 (1.1.1.1), 30 hops max, 60 byte packets\n" +
		" 1  192.168.1.1  0.512 ms\n" +
		" 2  *\n" +
		" 3  1.1.1.1  12.345 ms\n")
	hops := parseTracerouteOutput(linux)
	require.Len(t, hops, 3)
	assert.Equal(t, Hop{TTL: 1, IP: "192.168.1.1", RTT: 0.512}, hops[0])
	assert.Equal(t, Hop{TTL: 2}, hops[1], "a silent hop")
	assert.Equal(t, "1.1.1.1", hops[2].IP)

	windows := []byte("\r\nDétermination de l'itinéraire vers 1.1.1.1 avec un maximum de 30 sauts.\r\n\r\n" +
		"  1    <1 ms    <1 ms    <1 ms  192.168.1.1\r\n" +
		"  2     *        *        *     Délai d'attente de la demande dépassé.\r\n" +
		"  3    12 ms    11 ms    13 ms  1.1.1.1\r\n\r\nItinéraire déterminé.\r\n")
	hops = parseTracerouteOutput(windows)
	require.Len(t, hops, 3)
	assert.Equal(t, Hop{TTL: 1, IP: "192.168.1.1", RTT: 1}, hops[0], "<1 ms read as 1 ms")
	assert.Equal(t, "", hops[1].IP)
	assert.Equal(t, Hop{TTL: 3, IP: "1.1.1.1", RTT: 12}, hops[2])
}

func TestMatchesEcho(t *testing.T) {
	// quoted IPv4 header of 20 bytes, then the echo request: type, code, checksum, id, seq
	quoted := make([]byte, 28)
	quoted[0] = 0x45
	binary.BigEndian.PutUint16(quoted[24:], 0x1234)
	binary.BigEndian.PutUint16(quoted[26:], 7)
	assert.True(t, matchesEcho(quoted, false, 0x1234, 7))
	assert.False(t, matchesEcho(quoted, false, 0x1234, 8), "another TTL")
	assert.False(t, matchesEcho(quoted[:20], false, 0x1234, 7), "truncated")
}
