// Package sensors checks network hosts from the hub itself: ICMP, TCP ports,
// HTTP pages, DNS and NTP servers. Each sensor is a host with its checks; the
// hub records their response times, interruptions and quality, and alerts the
// users who asked for it.
package sensors

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/henrygd/beszel/internal/alerts"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const (
	// recentWindow is the period of the packet quality and of the loss and latency alerts.
	recentWindow = 10 * time.Minute
	// heartbeatWindow is the period of the heartbeat bar of a sensor page.
	heartbeatWindow = time.Hour
	// lossDegraded and lossBad are the packet loss (%) of a degraded and of a bad quality.
	lossDegraded = 2.0
	lossBad      = 20.0
	// uptimeRefresh is how often the uptime of the last 24 hours is recomputed.
	uptimeRefresh = 10 * time.Minute
	// defaultInterval is used for sensors without a valid interval.
	defaultInterval = time.Minute
)

// App is the hub seen by the sensors.
type App interface {
	core.App
	MakeLink(parts ...string) string
}

// Notifier sends the alerts of the sensors.
type Notifier interface {
	SendAlert(alerts.AlertMessageData) error
}

// Manager runs the probes of the sensors and keeps their state.
type Manager struct {
	app      App
	notifier Notifier

	mu      sync.Mutex
	sensors map[string]*sensor
	// alertSince is when the condition of each triggered or pending alert started.
	alertSince map[string]time.Time
	uptimeAt   time.Time

	ctx    context.Context
	cancel context.CancelFunc
}

// sensor is a host and its checks, probed together at the sensor interval.
type sensor struct {
	id, name, host   string
	interval         time.Duration
	retries          int
	latencyThreshold float64
	paused           bool
	// config identifies the settings that need the probes to restart when changed.
	config string
	checks []*checkState
	stop   context.CancelFunc

	// beats are the probes of all the checks over the last hour, for the heartbeat bar
	beats []sample

	status, quality  string
	res, loss        float64
	uptime           float64
	lastCheck        time.Time
	hasRecentSamples bool
}

// sample is one probe, kept for the recent quality.
type sample struct {
	at time.Time
	ok bool
	us int64
}

// checkState is a check with its probes of the current minute and its state.
type checkState struct {
	id    string
	label string
	check Check

	// probes of the current minute, written as a 1m stats record
	total, success, resSum, resMin, resMax int64
	recent                                 []sample

	failures     int
	firstFailure time.Time
	status       string
	incidentID   string
	last         Result
	lastAt       time.Time
	certExpiry   time.Time
	cert         *CertInfo
	changed      bool
}

// NewManager returns the sensors manager of the hub.
func NewManager(app App, notifier Notifier) *Manager {
	return &Manager{
		app:        app,
		notifier:   notifier,
		sensors:    map[string]*sensor{},
		alertSince: map[string]time.Time{},
	}
}

// Start loads the sensors, starts their probes and follows their changes.
func (m *Manager) Start() error {
	m.ctx, m.cancel = context.WithCancel(context.Background())
	records, err := m.app.FindAllRecords("sensors")
	if err != nil {
		return err
	}
	for _, record := range records {
		m.reload(record.Id)
	}
	reload := func(e *core.RecordEvent) error {
		sensorID := e.Record.Id
		if e.Record.Collection().Name == "sensor_checks" {
			sensorID = e.Record.GetString("sensor")
		}
		m.reload(sensorID)
		return e.Next()
	}
	for _, name := range []string{"sensors", "sensor_checks"} {
		m.app.OnRecordAfterCreateSuccess(name).BindFunc(reload)
		m.app.OnRecordAfterUpdateSuccess(name).BindFunc(reload)
		m.app.OnRecordAfterDeleteSuccess(name).BindFunc(reload)
	}
	// a new system gets the sensor pinging its host
	m.app.OnRecordAfterCreateSuccess("systems").BindFunc(func(e *core.RecordEvent) error {
		if err := m.addSystemSensor(e.Record); err != nil {
			m.app.Logger().Error("Failed to create the sensor of a system", "system", e.Record.Id, "err", err)
		}
		return e.Next()
	})
	go m.flushLoop()
	return nil
}

// Stop stops the probes.
func (m *Manager) Stop() {
	if m.cancel != nil {
		m.cancel()
	}
}

// reload reads a sensor and its checks, and restarts its probes when their settings changed.
func (m *Manager) reload(sensorID string) {
	record, err := m.app.FindRecordById("sensors", sensorID)
	m.mu.Lock()
	defer m.mu.Unlock()
	current := m.sensors[sensorID]
	if err != nil {
		// deleted
		if current != nil {
			current.stop()
			delete(m.sensors, sensorID)
		}
		return
	}
	checkRecords, err := m.app.FindAllRecords("sensor_checks", dbx.HashExp{"sensor": sensorID})
	if err != nil {
		return
	}
	next := newSensor(record, checkRecords)
	if current != nil {
		if current.config == next.config {
			// only the state kept by the hub changed
			current.name = next.name
			return
		}
		current.stop()
		next.keepState(current)
	} else {
		m.restoreIncidents(next)
		m.restoreBeats(next, time.Now().UTC())
	}
	m.sensors[sensorID] = next
	if next.paused || len(next.checks) == 0 {
		next.stop = func() {}
		return
	}
	ctx, cancel := context.WithCancel(m.ctx)
	next.stop = cancel
	go m.probeLoop(ctx, next)
}

// newSensor reads the settings of a sensor and of its checks.
func newSensor(record *core.Record, checkRecords []*core.Record) *sensor {
	s := &sensor{
		id:               record.Id,
		name:             record.GetString("name"),
		host:             record.GetString("host"),
		interval:         time.Duration(record.GetInt("interval")) * time.Second,
		retries:          record.GetInt("retries"),
		latencyThreshold: record.GetFloat("latency_threshold"),
		paused:           record.GetBool("paused"),
		status:           record.GetString("status"),
		quality:          record.GetString("quality"),
		uptime:           record.GetFloat("uptime"),
	}
	if s.interval < 10*time.Second {
		s.interval = defaultInterval
	}
	config := []any{s.host, s.interval, s.retries, s.latencyThreshold, s.paused}
	for _, r := range checkRecords {
		c := &checkState{
			id:    r.Id,
			label: r.GetString("label"),
			check: Check{
				Protocol:      r.GetString("protocol"),
				Host:          s.host,
				Port:          r.GetInt("port"),
				URL:           r.GetString("url"),
				Keyword:       r.GetString("keyword"),
				AcceptedCodes: r.GetString("accepted_codes"),
				IgnoreTLS:     r.GetBool("ignore_tls"),
			},
			status:     r.GetString("status"),
			certExpiry: r.GetDateTime("cert_expiry").Time(),
		}
		if c.status == "" {
			c.status = "pending"
		}
		s.checks = append(s.checks, c)
		config = append(config, c.id, c.check)
	}
	s.config = fmt.Sprint(config...)
	return s
}

// keepState keeps the state of the checks that still exist after a settings change.
func (s *sensor) keepState(previous *sensor) {
	for _, c := range s.checks {
		for _, old := range previous.checks {
			if old.id == c.id {
				c.status, c.incidentID, c.failures, c.firstFailure = old.status, old.incidentID, old.failures, old.firstFailure
				c.recent, c.certExpiry, c.last, c.lastAt, c.cert = old.recent, old.certExpiry, old.last, old.lastAt, old.cert
			}
		}
	}
	s.uptime = previous.uptime
	s.beats = previous.beats
}

// restoreIncidents finds the interruptions still open when the hub starts.
func (m *Manager) restoreIncidents(s *sensor) {
	for _, c := range s.checks {
		incident, err := m.app.FindFirstRecordByFilter("sensor_incidents", "check={:check} && end=''", dbx.Params{"check": c.id})
		if err == nil {
			c.incidentID = incident.Id
			c.status = "down"
			c.firstFailure = incident.GetDateTime("start").Time()
		}
	}
}

// probeLoop probes the checks of a sensor at its interval until stopped.
func (m *Manager) probeLoop(ctx context.Context, s *sensor) {
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()
	for {
		m.probeSensor(ctx, s)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// probeSensor probes all the checks of a sensor at once.
func (m *Manager) probeSensor(ctx context.Context, s *sensor) {
	// the rounds are dated by their start, one interval apart, whatever their duration
	start := time.Now().UTC()
	results := make([]Result, len(s.checks))
	var wg sync.WaitGroup
	for i, c := range s.checks {
		wg.Go(func() {
			results[i] = Probe(ctx, c.check)
		})
	}
	wg.Wait()
	if ctx.Err() != nil {
		return
	}
	now := time.Now().UTC()
	for i, c := range s.checks {
		m.applyResult(s, c, results[i], now)
	}
	m.mu.Lock()
	for _, r := range results {
		s.beats = append(trimOlder(s.beats, start, heartbeatWindow), sample{at: start, ok: r.OK})
	}
	m.mu.Unlock()
}

// applyResult counts a probe and follows the state of the check: down after
// more failures in a row than the retries, with an interruption, up again at
// the first success.
func (m *Manager) applyResult(s *sensor, c *checkState, result Result, at time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c.total++
	c.last, c.lastAt, c.changed = result, at, true
	if !result.CertExpiry.IsZero() {
		c.certExpiry = result.CertExpiry
	}
	if result.Cert != nil {
		c.cert = result.Cert
	}
	c.recent = append(trimSamples(c.recent, at), sample{at: at, ok: result.OK, us: result.ResponseUs})
	if result.OK {
		c.success++
		c.resSum += result.ResponseUs
		if c.resMin == 0 || result.ResponseUs < c.resMin {
			c.resMin = result.ResponseUs
		}
		c.resMax = max(c.resMax, result.ResponseUs)
		c.failures = 0
		if c.status == "down" {
			m.closeIncident(c, at)
		}
		c.status = "up"
		return
	}
	c.failures++
	if c.failures == 1 {
		c.firstFailure = at
	}
	if c.failures > s.retries && c.status != "down" {
		c.status = "down"
		m.openIncident(s, c)
	}
}

// trimSamples drops the samples older than the recent window.
func trimSamples(samples []sample, now time.Time) []sample {
	return trimOlder(samples, now, recentWindow)
}

// trimOlder drops the samples older than the window.
func trimOlder(samples []sample, now time.Time, window time.Duration) []sample {
	cut := 0
	for cut < len(samples) && now.Sub(samples[cut].at) > window {
		cut++
	}
	return samples[cut:]
}

// Beat is the count of probes of a sensor in a period of the heartbeat bar.
type Beat struct {
	// Start of the period, in milliseconds
	Time    int64 `json:"t"`
	Total   int   `json:"total"`
	Success int   `json:"success"`
}

// Heartbeat returns the probes of a sensor over the window (an hour at most),
// by period of the given length ending with the latest probe, oldest first;
// periods without probes have a zero total. ok is false for an unknown sensor.
func (m *Manager) Heartbeat(sensorID string, period, window time.Duration, now time.Time) (beats []Beat, ok bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := m.sensors[sensorID]
	if s == nil {
		return nil, false
	}
	return s.heartbeat(period, window, now), true
}

// Heartbeats returns the last periods of every sensor, one per interval of the
// sensor (within the last hour), for the tiles of the sensors page.
func (m *Manager) Heartbeats(bars int, now time.Time) map[string][]Beat {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := make(map[string][]Beat, len(m.sensors))
	for id, s := range m.sensors {
		result[id] = s.heartbeat(s.interval, time.Duration(bars)*s.interval, now)
	}
	return result
}

// heartbeat counts the probes of the sensor by period; the caller holds the lock.
func (s *sensor) heartbeat(period, window time.Duration, now time.Time) (beats []Beat) {
	count := max(1, int(min(window, heartbeatWindow)/period))
	// The periods are counted back from the latest probe, so the last one always
	// holds it: aligned on the clock, the current period is often still empty.
	// Without a recent probe (paused, stopped), they end now and show the gap.
	end := now
	if n := len(s.beats); n > 0 && now.Sub(s.beats[n-1].at) <= 2*period {
		end = s.beats[n-1].at
	}
	beats = make([]Beat, count)
	for i := range beats {
		// the time of the round of each period
		beats[i].Time = end.Add(-time.Duration(count-1-i) * period).UnixMilli()
	}
	for _, sm := range s.beats {
		if sm.at.After(end) {
			continue
		}
		// rounded to the nearest period: the rounds are one interval apart, give or take a few milliseconds
		i := count - 1 - int((end.Sub(sm.at)+period/2)/period)
		if i < 0 {
			continue
		}
		beats[i].Total++
		if sm.ok {
			beats[i].Success++
		}
	}
	return beats
}

// openIncident records the start of an interruption.
func (m *Manager) openIncident(s *sensor, c *checkState) {
	collection, err := m.app.FindCachedCollectionByNameOrId("sensor_incidents")
	if err != nil {
		return
	}
	record := core.NewRecord(collection)
	record.Set("sensor", s.id)
	record.Set("check", c.id)
	record.Set("start", c.firstFailure)
	record.Set("code", c.last.Code)
	record.Set("message", truncate(c.last.Message, 500))
	if err := m.app.Save(record); err != nil {
		m.app.Logger().Error("Failed to save sensor incident", "err", err)
		return
	}
	c.incidentID = record.Id
}

// closeIncident records the end of an interruption.
func (m *Manager) closeIncident(c *checkState, at time.Time) {
	if c.incidentID == "" {
		return
	}
	record, err := m.app.FindRecordById("sensor_incidents", c.incidentID)
	c.incidentID = ""
	if err != nil {
		return
	}
	record.Set("end", at)
	if err := m.app.Save(record); err != nil {
		m.app.Logger().Error("Failed to close sensor incident", "err", err)
	}
}

// truncate keeps the first characters of a text, without cutting one in two.
func truncate(text string, size int) string {
	runes := []rune(text)
	if len(runes) <= size {
		return text
	}
	return string(runes[:size])
}

// flushLoop saves the stats and the state every minute.
func (m *Manager) flushLoop() {
	// start at the next minute
	timer := time.NewTimer(time.Until(time.Now().Truncate(time.Minute).Add(time.Minute)))
	defer timer.Stop()
	for {
		select {
		case <-m.ctx.Done():
			return
		case <-timer.C:
			m.flush(time.Now().UTC())
			timer.Reset(time.Until(time.Now().Truncate(time.Minute).Add(time.Minute)))
		}
	}
}

// statsRow is a 1m stats record to save.
type statsRow struct {
	sensor, check                          string
	total, success, resSum, resMin, resMax int64
}

// flush saves the stats of the minute, the state of the checks and sensors,
// and evaluates the alerts.
func (m *Manager) flush(now time.Time) {
	m.mu.Lock()
	var rows []statsRow
	type checkUpdate struct {
		id                    string
		status, message       string
		res                   float64
		code                  int
		certExpiry, lastCheck time.Time
		cert                  *CertInfo
	}
	var checkUpdates []checkUpdate
	sensors := make([]*sensor, 0, len(m.sensors))
	// probes of the last hour of each sensor, saved for the heartbeat bar
	beats := map[string][]round{}
	for _, s := range m.sensors {
		if len(s.beats) > 0 {
			s.beats = trimOlder(s.beats, now, heartbeatWindow)
			beats[s.id] = packBeats(s.beats)
		}
		for _, c := range s.checks {
			if c.total > 0 {
				rows = append(rows, statsRow{s.id, c.id, c.total, c.success, c.resSum, c.resMin, c.resMax})
				c.total, c.success, c.resSum, c.resMin, c.resMax = 0, 0, 0, 0, 0
			}
			if c.changed {
				c.changed = false
				res := 0.0
				if c.last.OK {
					res = float64(c.last.ResponseUs) / 1000
				}
				checkUpdates = append(checkUpdates, checkUpdate{c.id, c.status, c.last.Message, res, c.last.Code, c.certExpiry, c.lastAt, c.cert})
			}
		}
		s.summarize(now)
		sensors = append(sensors, s)
	}
	refreshUptime := now.Sub(m.uptimeAt) >= uptimeRefresh
	if refreshUptime {
		m.uptimeAt = now
	}
	m.mu.Unlock()

	if err := m.saveStats(rows, now); err != nil {
		m.app.Logger().Error("Failed to save sensor stats", "err", err)
	}
	for _, u := range checkUpdates {
		record, err := m.app.FindRecordById("sensor_checks", u.id)
		if err != nil {
			continue
		}
		record.Set("status", u.status)
		record.Set("message", truncate(u.message, 500))
		record.Set("res", u.res)
		record.Set("code", u.code)
		record.Set("last_check", u.lastCheck)
		if !u.certExpiry.IsZero() {
			record.Set("cert_expiry", u.certExpiry)
		}
		if u.cert != nil {
			record.Set("cert", u.cert)
		}
		if err := m.app.Save(record); err != nil {
			m.app.Logger().Error("Failed to save sensor check", "err", err)
		}
	}
	for _, s := range sensors {
		if refreshUptime {
			m.refreshUptime(s, now)
		}
		m.saveSensor(s)
		if rounds, ok := beats[s.id]; ok {
			m.saveBeats(s.id, rounds)
		}
	}
	m.evaluateAlerts(now)
}

func (m *Manager) saveStats(rows []statsRow, now time.Time) error {
	if len(rows) == 0 {
		return nil
	}
	collection, err := m.app.FindCachedCollectionByNameOrId("sensor_stats")
	if err != nil {
		return err
	}
	return m.app.RunInTransaction(func(tx core.App) error {
		for _, row := range rows {
			record := core.NewRecord(collection)
			record.Set("sensor", row.sensor)
			record.Set("check", row.check)
			record.Set("type", "1m")
			record.Set("created", now.UnixMilli())
			record.Set("total_count", row.total)
			record.Set("success_count", row.success)
			record.Set("res_sum", row.resSum)
			record.Set("res_min", row.resMin)
			record.Set("res_max", row.resMax)
			if err := tx.SaveNoValidate(record); err != nil {
				return err
			}
		}
		return nil
	})
}

// summarize computes the state of a sensor from its checks: status, packet
// loss and average response time over the recent window, and quality.
func (s *sensor) summarize(now time.Time) {
	var total, failed int
	var sumUs int64
	anyDown, allPending := false, true
	for _, c := range s.checks {
		c.recent = trimSamples(c.recent, now)
		for _, sm := range c.recent {
			total++
			if sm.ok {
				sumUs += sm.us
			} else {
				failed++
			}
		}
		if c.status == "down" {
			anyDown = true
		}
		if c.status != "pending" {
			allPending = false
		}
		if c.lastAt.After(s.lastCheck) {
			s.lastCheck = c.lastAt
		}
	}
	switch {
	case s.paused:
		s.status = "paused"
	case anyDown:
		s.status = "down"
	case len(s.checks) == 0 || allPending:
		s.status = "pending"
	default:
		s.status = "up"
	}
	s.hasRecentSamples = total > 0
	if total == 0 {
		return
	}
	s.loss = roundTwo(float64(failed) * 100 / float64(total))
	s.res = 0
	if ok := total - failed; ok > 0 {
		s.res = roundTwo(float64(sumUs) / float64(ok) / 1000)
	}
	switch {
	case s.status == "down" || s.loss >= lossBad:
		s.quality = "bad"
	case s.loss >= lossDegraded || (s.latencyThreshold > 0 && s.res > s.latencyThreshold):
		s.quality = "degraded"
	default:
		s.quality = "good"
	}
}

func roundTwo(value float64) float64 {
	return float64(int64(value*100+0.5)) / 100
}

// refreshUptime computes the share of successful probes over the last 24 hours.
func (m *Manager) refreshUptime(s *sensor, now time.Time) {
	var result struct {
		Total   int64 `db:"total"`
		Success int64 `db:"success"`
	}
	since := now.Add(-24 * time.Hour).UnixMilli()
	for _, recordType := range []string{"20m", "1m"} {
		err := m.app.DB().Select("COALESCE(SUM(total_count), 0) AS total", "COALESCE(SUM(success_count), 0) AS success").
			From("sensor_stats").
			Where(dbx.NewExp("sensor={:sensor} AND type={:type} AND created>{:since}", dbx.Params{"sensor": s.id, "type": recordType, "since": since})).
			One(&result)
		if err == nil && result.Total > 0 {
			m.mu.Lock()
			s.uptime = roundTwo(float64(result.Success) * 100 / float64(result.Total))
			m.mu.Unlock()
			return
		}
	}
}

// saveSensor saves the state of a sensor when it changed.
func (m *Manager) saveSensor(s *sensor) {
	record, err := m.app.FindRecordById("sensors", s.id)
	if err != nil {
		return
	}
	m.mu.Lock()
	values := map[string]any{"status": s.status, "uptime": s.uptime}
	if s.hasRecentSamples {
		values["quality"], values["res"], values["loss"] = s.quality, s.res, s.loss
	}
	lastCheck := s.lastCheck
	m.mu.Unlock()
	changed := false
	for field, value := range values {
		if record.Get(field) != value {
			record.Set(field, value)
			changed = true
		}
	}
	if !lastCheck.IsZero() && !record.GetDateTime("last_check").Time().Equal(lastCheck) {
		record.Set("last_check", lastCheck)
		changed = true
	}
	if !changed {
		return
	}
	if err := m.app.Save(record); err != nil {
		m.app.Logger().Error("Failed to save sensor", "err", err)
	}
}

// addSystemSensor creates the sensor pinging the host of a new system, named
// and grouped like it, unless a sensor already checks this host. The host and
// the sensor are then associated by their shared address.
func (m *Manager) addSystemSensor(system *core.Record) error {
	host := strings.TrimSpace(system.GetString("host"))
	// no address to ping: agents behind a unix socket or without a known address
	if host == "" || strings.HasPrefix(host, "/") {
		return nil
	}
	existing, err := m.app.CountRecords("sensors", dbx.NewExp("lower(host) = lower({:host})", dbx.Params{"host": host}))
	if err != nil || existing > 0 {
		return err
	}
	sensors, err := m.app.FindCollectionByNameOrId("sensors")
	if err != nil {
		return err
	}
	checks, err := m.app.FindCollectionByNameOrId("sensor_checks")
	if err != nil {
		return err
	}
	sensor := core.NewRecord(sensors)
	sensor.Set("name", truncate(system.GetString("name"), 100))
	sensor.Set("host", host)
	sensor.Set("group", truncate(strings.TrimSpace(system.GetString("group")), 40))
	sensor.Set("interval", 60)
	sensor.Set("retries", 1)
	sensor.Set("status", "pending")
	if err := m.app.Save(sensor); err != nil {
		return err
	}
	check := core.NewRecord(checks)
	check.Set("sensor", sensor.Id)
	check.Set("protocol", "icmp")
	check.Set("label", "Ping")
	return m.app.Save(check)
}
