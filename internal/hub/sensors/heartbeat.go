package sensors

import (
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// heartbeatCollection keeps the probes of the last hour of each sensor, so the
// heartbeat bar of its page survives a restart of the hub.
const heartbeatCollection = "sensor_heartbeats"

// round is the probes of one round of a sensor, as saved: its start in
// milliseconds, the probes and the successful ones.
type round struct {
	Time    int64 `json:"t"`
	Total   int   `json:"n"`
	Success int   `json:"ok"`
}

// packBeats groups the probes by round, the probes of a round sharing its start.
func packBeats(beats []sample) []round {
	rounds := []round{}
	for _, sm := range beats {
		ms := sm.at.UnixMilli()
		if n := len(rounds); n == 0 || rounds[n-1].Time != ms {
			rounds = append(rounds, round{Time: ms})
		}
		r := &rounds[len(rounds)-1]
		r.Total++
		if sm.ok {
			r.Success++
		}
	}
	return rounds
}

// unpackBeats restores the probes of the saved rounds younger than the window.
func unpackBeats(rounds []round, now time.Time) []sample {
	var beats []sample
	for _, r := range rounds {
		at := time.UnixMilli(r.Time).UTC()
		if now.Sub(at) > heartbeatWindow {
			continue
		}
		for i := range r.Total {
			beats = append(beats, sample{at: at, ok: i < r.Success})
		}
	}
	return beats
}

// saveBeats saves the probes of the last hour of a sensor.
func (m *Manager) saveBeats(sensorID string, rounds []round) {
	record, err := m.app.FindFirstRecordByFilter(heartbeatCollection, "sensor={:sensor}", dbx.Params{"sensor": sensorID})
	if err != nil {
		collection, err := m.app.FindCachedCollectionByNameOrId(heartbeatCollection)
		if err != nil {
			return
		}
		record = core.NewRecord(collection)
		record.Set("sensor", sensorID)
	}
	record.Set("rounds", rounds)
	if err := m.app.Save(record); err != nil {
		m.app.Logger().Error("Failed to save sensor heartbeat", "sensor", sensorID, "err", err)
	}
}

// restoreBeats reads the probes of the last hour saved for a sensor.
func (m *Manager) restoreBeats(s *sensor, now time.Time) {
	record, err := m.app.FindFirstRecordByFilter(heartbeatCollection, "sensor={:sensor}", dbx.Params{"sensor": s.id})
	if err != nil {
		return
	}
	var rounds []round
	if err := record.UnmarshalJSONField("rounds", &rounds); err != nil {
		return
	}
	s.beats = unpackBeats(rounds, now)
}
