//go:build testing

package hub

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestTOTP(t *testing.T) {
	// RFC 6238 test vector (SHA-1), last 6 digits of 94287082 at T=59
	assert.Equal(t, "287082", totpCode([]byte("12345678901234567890"), 1))

	secret := totpEncoding.EncodeToString([]byte("12345678901234567890"))
	now := time.Unix(59, 0)
	step, ok := verifyTOTP(secret, "287 082", now, 0)
	assert.True(t, ok)
	assert.EqualValues(t, 1, step)
	_, ok = verifyTOTP(secret, "287082", now, step)
	assert.False(t, ok, "a code can't be used twice")
	_, ok = verifyTOTP(secret, "287082", now.Add(2*time.Minute), 0)
	assert.False(t, ok, "too old")
	_, ok = verifyTOTP(secret, "000000", now, 0)
	assert.False(t, ok)
}

func TestRecoveryCodes(t *testing.T) {
	codes, hashes := newRecoveryCodes()
	assert.Len(t, codes, recoveryCodesLen)
	assert.Regexp(t, `^[2-9a-z]{5}-[2-9a-z]{5}$`, codes[0])
	assert.Equal(t, hashes[0], hashRecoveryCode(" "+codes[0][:5]+codes[0][6:]+" "), "without dash or spaces")
}
