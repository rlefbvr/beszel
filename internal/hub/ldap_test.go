//go:build testing

package hub

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestLDAPUsername(t *testing.T) {
	assert.Equal(t, "jean_dupont", usernameFor(ldapUser{Email: "Jean_Dupont@example.com"}))
	assert.Equal(t, "jeandupont", usernameFor(ldapUser{Email: "jean.dupont@example.com"}))
	assert.Regexp(t, `^user_[a-z0-9]{6}$`, usernameFor(ldapUser{Email: "é@example.com"}))
}

func TestLDAPFailures(t *testing.T) {
	f := ldapFailures{byIP: map[string][]time.Time{}}
	now := time.Now()
	for range ldapMaxFailures - 1 {
		f.add("10.0.0.1", now)
	}
	assert.False(t, f.blocked("10.0.0.1", now))
	f.add("10.0.0.1", now)
	assert.True(t, f.blocked("10.0.0.1", now))
	assert.False(t, f.blocked("10.0.0.2", now), "other address")
	assert.False(t, f.blocked("10.0.0.1", now.Add(ldapFailWindow+time.Second)), "old failures")
}

func TestLDAPDialURL(t *testing.T) {
	_, err := ldapConfig{URL: "http://dc.example.com"}.dial()
	assert.ErrorContains(t, err, "invalid directory URL")
}
