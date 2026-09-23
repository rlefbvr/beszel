package agent

import (
	"log/slog"
	"sync/atomic"
	"time"
)

const (
	// defaultServicesInterval is used until the hub sends a collection interval.
	defaultServicesInterval = 10 * time.Minute
	// minServicesInterval matches the hub's default update interval.
	minServicesInterval = time.Minute
)

// serviceRefresher runs service collection on an interval the hub can adjust.
type serviceRefresher struct {
	interval atomic.Int64
	reset    chan struct{}
}

func newServiceRefresher() *serviceRefresher {
	r := &serviceRefresher{reset: make(chan struct{}, 1)}
	r.interval.Store(int64(defaultServicesInterval))
	return r
}

// runRefreshLoop calls refresh every interval, restarting the wait when the interval changes.
// It runs until done is closed; a nil done runs forever.
func (r *serviceRefresher) runRefreshLoop(done <-chan struct{}, refresh func()) {
	timer := time.NewTimer(time.Duration(r.interval.Load()))
	for {
		select {
		case <-done:
			timer.Stop()
			return
		case <-timer.C:
			refresh()
			timer.Reset(time.Duration(r.interval.Load()))
		case <-r.reset:
			timer.Reset(time.Duration(r.interval.Load()))
		}
	}
}

// setServicesInterval updates the collection interval requested by the hub.
func (r *serviceRefresher) setServicesInterval(d time.Duration) {
	if r == nil {
		return
	}
	d = max(d, minServicesInterval)
	if time.Duration(r.interval.Swap(int64(d))) == d {
		return
	}
	slog.Debug("Services collection interval", "interval", d)
	select {
	case r.reset <- struct{}{}:
	default: // a reset is already pending and will read the latest interval
	}
}
