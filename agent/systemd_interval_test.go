//go:build testing

package agent

import (
	"testing"
	"testing/synctest"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestServiceRefresherDefaultInterval(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		r := newServiceRefresher()
		calls := 0
		done := make(chan struct{})
		defer close(done)
		go r.runRefreshLoop(done, func() { calls++ })

		time.Sleep(defaultServicesInterval - time.Second)
		synctest.Wait()
		assert.Equal(t, 0, calls)

		time.Sleep(time.Second)
		synctest.Wait()
		assert.Equal(t, 1, calls)
	})
}

func TestServiceRefresherSetInterval(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		r := newServiceRefresher()
		calls := 0
		done := make(chan struct{})
		defer close(done)
		go r.runRefreshLoop(done, func() { calls++ })
		synctest.Wait()

		// a shorter interval restarts the wait instead of waiting out the default
		r.setServicesInterval(2 * time.Minute)
		synctest.Wait()
		time.Sleep(2 * time.Minute)
		synctest.Wait()
		assert.Equal(t, 1, calls)

		time.Sleep(2 * time.Minute)
		synctest.Wait()
		assert.Equal(t, 2, calls)

		// values below the minimum are clamped
		r.setServicesInterval(time.Second)
		assert.Equal(t, int64(minServicesInterval), r.interval.Load())
	})
}

func TestServiceRefresherNilSafe(t *testing.T) {
	var r *serviceRefresher
	assert.NotPanics(t, func() { r.setServicesInterval(time.Minute) })
}
