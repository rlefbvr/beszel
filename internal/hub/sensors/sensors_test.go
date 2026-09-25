//go:build testing

package sensors

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
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
