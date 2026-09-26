package hub

import (
	"encoding/json"
	"errors"
	"slices"
	"time"

	"github.com/henrygd/beszel/internal/hub/hubsettings"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Audit log: the logins, successful or failed, and the changes of the
// sensitive collections through the API, with who, from where and on what.

const (
	auditCollection = "audit_logs"
	// defaultAuditRetentionDays keeps the log when hub_settings has no value
	defaultAuditRetentionDays = 90
)

// auditedCollections are the collections whose changes are logged.
var auditedCollections = []string{
	"systems", "users", core.CollectionNameSuperusers, "alerts", "state_alerts", "quiet_hours",
	"sensors", "sensor_checks", "sensor_alerts", "network_monitors", "fingerprints", "hub_settings",
	"certificate_paths", "certificate_alerts",
}

// auditHiddenFields are never written in the details of a change.
var auditHiddenFields = []string{"password", "tokenKey", "totp_secret", "totp_pending", "mfa_recovery", "bind_password", "updated", "created"}

// auditEntry is a line of the audit log.
type auditEntry struct {
	user       *core.Record
	email      string
	action     string
	targetType string
	targetID   string
	targetName string
	details    map[string]any
}

// writeAudit saves an entry with the address and browser of the request.
// Failures are only logged: the audit never blocks the request.
func writeAudit(e *core.RequestEvent, entry auditEntry) {
	collection, err := e.App.FindCachedCollectionByNameOrId(auditCollection)
	if err != nil {
		return
	}
	record := core.NewRecord(collection)
	if entry.user != nil {
		if entry.user.Collection().Name == "users" {
			record.Set("user", entry.user.Id)
		}
		if entry.email == "" {
			entry.email = entry.user.Email()
		}
	}
	record.Set("email", entry.email)
	record.Set("action", entry.action)
	record.Set("target_type", entry.targetType)
	record.Set("target_id", entry.targetID)
	record.Set("target_name", truncate(entry.targetName, 500))
	record.Set("ip", e.RealIP())
	record.Set("user_agent", truncate(e.Request.UserAgent(), 500))
	if entry.details != nil {
		record.Set("details", entry.details)
	}
	if err := e.App.Save(record); err != nil {
		e.App.Logger().Warn("Failed to save audit log", "action", entry.action, "err", err)
	}
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}

// recordName is a readable name of a changed record.
func recordName(record *core.Record) string {
	for _, field := range []string{"name", "email", "host", "target", "path", "label"} {
		if record.Collection().Fields.GetByName(field) != nil {
			if value := record.GetString(field); value != "" {
				return value
			}
		}
	}
	return ""
}

// logSecurityEvent logs an action of a user on their account (second factor...).
func (h *Hub) logSecurityEvent(e *core.RequestEvent, user *core.Record, action string, details map[string]any) {
	writeAudit(e, auditEntry{user: user, action: action, targetType: "users", targetID: user.Id, targetName: user.Email(), details: details})
}

// logAuthFailure logs a failed login.
func (h *Hub) logAuthFailure(e *core.RequestEvent, identity, method string) {
	writeAudit(e, auditEntry{email: identity, action: "login_failed", targetType: method})
}

// bindAudit adds the hooks writing the audit log.
func (h *Hub) bindAudit() {
	authCollections := []string{"users", core.CollectionNameSuperusers}

	// successful logins; a password waiting for its second factor is a step
	h.OnRecordAuthRequest(authCollections...).BindFunc(func(e *core.RecordAuthRequestEvent) error {
		err := e.Next()
		switch {
		case e.AuthMethod == "":
			// token refresh
		case errors.Is(err, apis.ErrMFA):
			writeAudit(e.RequestEvent, auditEntry{user: e.Record, action: "login_mfa", targetType: e.AuthMethod})
		case err == nil:
			writeAudit(e.RequestEvent, auditEntry{user: e.Record, action: "login", targetType: e.AuthMethod})
		}
		return err
	})

	// failed logins
	h.OnRecordAuthWithPasswordRequest(authCollections...).BindFunc(func(e *core.RecordAuthWithPasswordRequestEvent) error {
		err := e.Next()
		if err != nil && !errors.Is(err, apis.ErrMFA) {
			h.logAuthFailure(e.RequestEvent, e.Identity, "password")
		}
		return err
	})
	h.OnRecordAuthWithOTPRequest(authCollections...).BindFunc(func(e *core.RecordAuthWithOTPRequestEvent) error {
		err := e.Next()
		if err != nil && !errors.Is(err, apis.ErrMFA) {
			email := ""
			if e.Record != nil {
				email = e.Record.Email()
			}
			h.logAuthFailure(e.RequestEvent, email, "otp")
		}
		return err
	})
	h.OnRecordAuthWithOAuth2Request(authCollections...).BindFunc(func(e *core.RecordAuthWithOAuth2RequestEvent) error {
		err := e.Next()
		if err != nil && !errors.Is(err, apis.ErrMFA) {
			email := ""
			if e.OAuth2User != nil {
				email = e.OAuth2User.Email
			}
			h.logAuthFailure(e.RequestEvent, email, "oauth2")
		}
		return err
	})

	// changes through the API, by the users or the superusers
	h.OnRecordCreateRequest(auditedCollections...).BindFunc(func(e *core.RecordRequestEvent) error {
		err := e.Next()
		if err == nil {
			writeAudit(e.RequestEvent, auditEntry{user: e.Auth, action: "create", targetType: e.Collection.Name,
				targetID: e.Record.Id, targetName: recordName(e.Record)})
		}
		return err
	})
	h.OnRecordUpdateRequest(auditedCollections...).BindFunc(func(e *core.RecordRequestEvent) error {
		original := e.Record.Original()
		err := e.Next()
		if err == nil {
			var changed []string
			for _, field := range e.Record.Collection().Fields.FieldNames() {
				if slices.Contains(auditHiddenFields, field) || original == nil {
					continue
				}
				if !valuesEqual(original.Get(field), e.Record.Get(field)) {
					changed = append(changed, field)
				}
			}
			writeAudit(e.RequestEvent, auditEntry{user: e.Auth, action: "update", targetType: e.Collection.Name,
				targetID: e.Record.Id, targetName: recordName(e.Record), details: map[string]any{"fields": changed}})
		}
		return err
	})
	h.OnRecordDeleteRequest(auditedCollections...).BindFunc(func(e *core.RecordRequestEvent) error {
		name := recordName(e.Record)
		err := e.Next()
		if err == nil {
			writeAudit(e.RequestEvent, auditEntry{user: e.Auth, action: "delete", targetType: e.Collection.Name,
				targetID: e.Record.Id, targetName: name})
		}
		return err
	})
}

// valuesEqual compares two field values through their JSON form.
func valuesEqual(a, b any) bool {
	ja, _ := json.Marshal(a)
	jb, _ := json.Marshal(b)
	return string(ja) == string(jb)
}

// deleteOldAuditLogs removes the entries older than the retention of the hub settings.
func deleteOldAuditLogs(app core.App) {
	days := hubsettings.AuditRetentionDays(app)
	if days <= 0 {
		days = defaultAuditRetentionDays
	}
	before := time.Now().UTC().AddDate(0, 0, -days).Format(types.DefaultDateLayout)
	if _, err := app.DB().Delete(auditCollection, dbx.NewExp("created < {:before}", dbx.Params{"before": before})).Execute(); err != nil {
		app.Logger().Warn("Failed to delete old audit logs", "err", err)
	}
}
