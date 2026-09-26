package hub

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/henrygd/beszel/internal/hub/utils"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/mails"
	"github.com/pocketbase/pocketbase/tools/security"
	"rsc.io/qr"
)

// Second factor of the users: an authenticator app (TOTP, RFC 6238) or a code
// sent by email (the PocketBase OTP). PocketBase asks for it after the password
// through its MFA, enabled for the users with a second factor (collections.go).

const (
	mfaTOTP  = "totp"
	mfaEmail = "email"
	// totpStep and totpDigits are the usual settings of the authenticator apps
	totpStep   = 30
	totpDigits = 6
	// totpMaxAttempts wrong codes end the MFA session
	totpMaxAttempts  = 5
	recoveryCodesLen = 8
)

var totpEncoding = base32.StdEncoding.WithPadding(base32.NoPadding)

// totpCode is the code of a time step.
func totpCode(secret []byte, step uint64) string {
	var counter [8]byte
	binary.BigEndian.PutUint64(counter[:], step)
	mac := hmac.New(sha1.New, secret)
	mac.Write(counter[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	value := binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff
	return fmt.Sprintf("%0*d", totpDigits, value%1_000_000)
}

// verifyTOTP returns the time step of a valid code, allowing one step of clock
// drift, and only after the last step already used.
func verifyTOTP(secret, code string, now time.Time, lastStep int64) (int64, bool) {
	key, err := totpEncoding.DecodeString(strings.ToUpper(secret))
	code = strings.ReplaceAll(strings.TrimSpace(code), " ", "")
	if err != nil || len(code) != totpDigits {
		return 0, false
	}
	current := now.Unix() / totpStep
	for _, step := range []int64{current - 1, current, current + 1} {
		if step <= lastStep {
			continue
		}
		if subtle.ConstantTimeCompare([]byte(totpCode(key, uint64(step))), []byte(code)) == 1 {
			return step, true
		}
	}
	return 0, false
}

func randomSecret() string {
	key := make([]byte, 20)
	_, _ = rand.Read(key)
	return totpEncoding.EncodeToString(key)
}

func hashRecoveryCode(code string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.ReplaceAll(strings.TrimSpace(code), "-", ""))))
	return hex.EncodeToString(sum[:])
}

// newRecoveryCodes returns codes such as 4f7k2-9xq3m and their hashes.
func newRecoveryCodes() (codes, hashes []string) {
	const alphabet = "23456789abcdefghjkmnpqrstuvwxyz"
	for range recoveryCodesLen {
		b := make([]byte, 10)
		_, _ = rand.Read(b)
		for i := range b {
			b[i] = alphabet[int(b[i])%len(alphabet)]
		}
		code := string(b[:5]) + "-" + string(b[5:])
		codes = append(codes, code)
		hashes = append(hashes, hashRecoveryCode(code))
	}
	return codes, hashes
}

// useRecoveryCode removes a recovery code of the user when it is valid.
func useRecoveryCode(record *core.Record, code string) bool {
	var hashes []string
	_ = record.UnmarshalJSONField("mfa_recovery", &hashes)
	index := slices.Index(hashes, hashRecoveryCode(code))
	if index < 0 {
		return false
	}
	record.Set("mfa_recovery", slices.Delete(hashes, index, index+1))
	return true
}

// mfaAttempts counts the wrong codes of each MFA session.
type mfaAttempts struct {
	sync.Mutex
	count map[string]int
}

func (a *mfaAttempts) fail(mfaID string) int {
	a.Lock()
	defer a.Unlock()
	if a.count == nil {
		a.count = map[string]int{}
	}
	a.count[mfaID]++
	return a.count[mfaID]
}

func (a *mfaAttempts) clear(mfaID string) {
	a.Lock()
	defer a.Unlock()
	delete(a.count, mfaID)
}

var totpAttempts mfaAttempts

// emailOTPForAll tells the upstream mode where every user gets an email code (MFA_OTP=true).
func emailOTPForAll() bool {
	mfaOtp, _ := utils.GetEnv("MFA_OTP")
	return mfaOtp == "true"
}

// guardOTP keeps the email codes for the users who chose them: they are not a
// first factor on their own, nor a way around an authenticator app.
func (h *Hub) guardOTP() {
	h.OnRecordRequestOTPRequest("users").BindFunc(func(e *core.RecordCreateOTPRequestEvent) error {
		if emailOTPForAll() || e.Record == nil || e.Record.GetString("mfa") == mfaEmail {
			return e.Next()
		}
		// same answer as for an unknown email, without sending anything
		return e.JSON(http.StatusOK, map[string]string{"otpId": core.GenerateDefaultRandomId()})
	})
	h.OnRecordAuthWithOTPRequest("users").BindFunc(func(e *core.RecordAuthWithOTPRequestEvent) error {
		if emailOTPForAll() || e.Record.GetString("mfa") == mfaEmail {
			return e.Next()
		}
		return e.BadRequestError("Failed to authenticate.", nil)
	})
}

// getMFA returns the second factor of the current user.
func (h *Hub) getMFA(e *core.RequestEvent) error {
	var recovery []string
	_ = e.Auth.UnmarshalJSONField("mfa_recovery", &recovery)
	return e.JSON(http.StatusOK, map[string]any{
		"method":     e.Auth.GetString("mfa"),
		"recovery":   len(recovery),
		"emailReady": h.Settings().SMTP.Enabled,
		"forAll":     emailOTPForAll(),
	})
}

// setupTOTP starts the enrollment of an authenticator app: a new secret, with
// its QR code, confirmed by enableTOTP.
func (h *Hub) setupTOTP(e *core.RequestEvent) error {
	if e.Auth.Collection().Name != "users" {
		return e.ForbiddenError("", nil)
	}
	record, err := e.App.FindRecordById("users", e.Auth.Id)
	if err != nil {
		return e.NotFoundError("", err)
	}
	secret := randomSecret()
	record.Set("totp_pending", secret)
	if err := e.App.Save(record); err != nil {
		return e.InternalServerError("", err)
	}
	issuer := "Beszel"
	if name := strings.TrimSpace(e.App.Settings().Meta.AppName); name != "" && name != "Acme" {
		issuer = name
	}
	uri := fmt.Sprintf("otpauth://totp/%s:%s?secret=%s&issuer=%s&algorithm=SHA1&digits=%d&period=%d",
		url.PathEscape(issuer), url.PathEscape(record.GetString("email")), secret, url.QueryEscape(issuer), totpDigits, totpStep)
	code, err := qr.Encode(uri, qr.M)
	if err != nil {
		return e.InternalServerError("", err)
	}
	return e.JSON(http.StatusOK, map[string]string{
		"secret": secret,
		"uri":    uri,
		"qr":     "data:image/png;base64," + base64.StdEncoding.EncodeToString(code.PNG()),
	})
}

// enableTOTP confirms the authenticator app with a first code and returns the recovery codes.
func (h *Hub) enableTOTP(e *core.RequestEvent) error {
	var body struct {
		Code string `json:"code"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("", err)
	}
	record, err := e.App.FindRecordById("users", e.Auth.Id)
	if err != nil {
		return e.NotFoundError("", err)
	}
	secret := record.GetString("totp_pending")
	step, ok := verifyTOTP(secret, body.Code, time.Now(), 0)
	if secret == "" || !ok {
		return e.BadRequestError("Invalid code.", nil)
	}
	codes, hashes := newRecoveryCodes()
	record.Set("totp_secret", secret)
	record.Set("totp_pending", "")
	record.Set("totp_last", step)
	record.Set("mfa_recovery", hashes)
	record.Set("mfa", mfaTOTP)
	if err := e.App.Save(record); err != nil {
		return e.InternalServerError("", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"recoveryCodes": codes})
}

// enableEmailMFA makes the code sent by email the second factor of the user.
func (h *Hub) enableEmailMFA(e *core.RequestEvent) error {
	if !h.Settings().SMTP.Enabled {
		return e.BadRequestError("Email sending is not configured on the hub.", nil)
	}
	record, err := e.App.FindRecordById("users", e.Auth.Id)
	if err != nil {
		return e.NotFoundError("", err)
	}
	record.Set("mfa", mfaEmail)
	record.Set("totp_secret", "")
	record.Set("totp_pending", "")
	record.Set("mfa_recovery", []string{})
	if err := e.App.Save(record); err != nil {
		return e.InternalServerError("", err)
	}
	return e.JSON(http.StatusOK, map[string]string{"status": "ok"})
}

// checkMFAProof checks the password of the user, or a code of their authenticator app.
func checkMFAProof(record *core.Record, password, code string) bool {
	if password != "" && record.ValidatePassword(password) {
		return true
	}
	if code != "" && record.GetString("mfa") == mfaTOTP {
		if step, ok := verifyTOTP(record.GetString("totp_secret"), code, time.Now(), int64(record.GetInt("totp_last"))); ok {
			record.Set("totp_last", step)
			return true
		}
	}
	return false
}

// renewRecoveryCodes replaces the recovery codes of the authenticator app.
func (h *Hub) renewRecoveryCodes(e *core.RequestEvent) error {
	var body struct {
		Password string `json:"password"`
		Code     string `json:"code"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("", err)
	}
	record, err := e.App.FindRecordById("users", e.Auth.Id)
	if err != nil {
		return e.NotFoundError("", err)
	}
	if record.GetString("mfa") != mfaTOTP || !checkMFAProof(record, body.Password, body.Code) {
		return e.BadRequestError("Invalid password or code.", nil)
	}
	codes, hashes := newRecoveryCodes()
	record.Set("mfa_recovery", hashes)
	if err := e.App.Save(record); err != nil {
		return e.InternalServerError("", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"recoveryCodes": codes})
}

// disableMFA removes the second factor of the user, after their password or a code.
func (h *Hub) disableMFA(e *core.RequestEvent) error {
	var body struct {
		Password string `json:"password"`
		Code     string `json:"code"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("", err)
	}
	record, err := e.App.FindRecordById("users", e.Auth.Id)
	if err != nil {
		return e.NotFoundError("", err)
	}
	if !checkMFAProof(record, body.Password, body.Code) {
		return e.BadRequestError("Invalid password or code.", nil)
	}
	record.Set("mfa", "")
	record.Set("totp_secret", "")
	record.Set("totp_pending", "")
	record.Set("mfa_recovery", []string{})
	if err := e.App.Save(record); err != nil {
		return e.InternalServerError("", err)
	}
	return e.JSON(http.StatusOK, map[string]string{"status": "ok"})
}

// mfaRecord returns the user of a pending MFA session.
func mfaRecord(app core.App, mfaID string) (*core.MFA, *core.Record, error) {
	mfa, err := app.FindMFAById(mfaID)
	if err != nil {
		return nil, nil, err
	}
	record, err := app.FindRecordById(mfa.CollectionRef(), mfa.RecordRef())
	return mfa, record, err
}

// getMFAMethod tells the login form which second factor to ask for.
func (h *Hub) getMFAMethod(e *core.RequestEvent) error {
	_, record, err := mfaRecord(e.App, e.Request.URL.Query().Get("mfaId"))
	if err != nil {
		return e.NotFoundError("", nil)
	}
	method := record.GetString("mfa")
	if method == "" || record.Collection().Name != "users" {
		// MFA_OTP for everyone, or the superusers
		method = mfaEmail
	}
	return e.JSON(http.StatusOK, map[string]string{"method": method})
}

// requestMFAEmailOTP sends the email code of a pending MFA session, for the
// logins without the email address at hand (directory logins).
func (h *Hub) requestMFAEmailOTP(e *core.RequestEvent) error {
	var body struct {
		MfaID string `json:"mfaId"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("", err)
	}
	_, record, err := mfaRecord(e.App, body.MfaID)
	if err != nil || (record.GetString("mfa") != mfaEmail && !emailOTPForAll()) {
		return e.BadRequestError("Invalid or expired MFA session.", nil)
	}
	password := security.RandomStringWithAlphabet(record.Collection().OTP.Length, "1234567890")
	otp := core.NewOTP(e.App)
	otp.SetCollectionRef(record.Collection().Id)
	otp.SetRecordRef(record.Id)
	otp.SetPassword(password)
	if err := e.App.Save(otp); err != nil {
		return e.InternalServerError("", err)
	}
	if err := mails.SendRecordOTP(e.App, record, otp.Id, password); err != nil {
		_ = e.App.Delete(otp)
		return e.InternalServerError("Failed to send the email.", err)
	}
	return e.JSON(http.StatusOK, map[string]string{"otpId": otp.Id})
}

// authWithTOTP completes a login with a code of the authenticator app, or a recovery code.
func (h *Hub) authWithTOTP(e *core.RequestEvent) error {
	var body struct {
		MfaID string `json:"mfaId"`
		Code  string `json:"code"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("", err)
	}
	mfa, record, err := mfaRecord(e.App, body.MfaID)
	if err != nil || record.GetString("mfa") != mfaTOTP {
		return e.BadRequestError("Invalid or expired MFA session.", nil)
	}
	step, ok := verifyTOTP(record.GetString("totp_secret"), body.Code, time.Now(), int64(record.GetInt("totp_last")))
	switch {
	case ok:
		record.Set("totp_last", step)
	case useRecoveryCode(record, body.Code):
	default:
		if totpAttempts.fail(body.MfaID) >= totpMaxAttempts {
			totpAttempts.clear(body.MfaID)
			_ = e.App.Delete(mfa)
		}
		return e.BadRequestError("Invalid code.", nil)
	}
	totpAttempts.clear(body.MfaID)
	if err := e.App.Save(record); err != nil {
		return e.InternalServerError("", err)
	}
	return apis.RecordAuthResponse(e, record, mfaTOTP, nil)
}
