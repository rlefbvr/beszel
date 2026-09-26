package hub

import (
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/go-ldap/ldap/v3"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/security"
)

// Login with an LDAP directory (Active Directory): the hub searches the user
// with a service account, checks their password by binding as them, maps their
// groups to a role, and logs in the Beszel user of the same email (created at
// the first login when allowed). The second factor of the user still applies.

const (
	ldapConfigCollection = "ldap_config"
	ldapConfigID         = "ldapconfig00000"
	ldapTimeout          = 10 * time.Second
	// AD matching rule following the nested groups
	ldapInChain = "1.2.840.113556.1.4.1941"
	// failed logins of an address before it waits
	ldapMaxFailures = 10
	ldapFailWindow  = 10 * time.Minute
)

// ldapConfig is the directory settings (ldap_config record).
type ldapConfig struct {
	Enabled        bool   `json:"enabled"`
	URL            string `json:"url"`
	StartTLS       bool   `json:"start_tls"`
	SkipVerify     bool   `json:"skip_verify"`
	BindDN         string `json:"bind_dn"`
	BindPassword   string `json:"bind_password,omitempty"`
	BaseDN         string `json:"base_dn"`
	UserFilter     string `json:"user_filter"`
	EmailAttribute string `json:"email_attribute"`
	AdminGroup     string `json:"admin_group"`
	UsersGroup     string `json:"users_group"`
	ReadonlyGroup  string `json:"readonly_group"`
	CreateUsers    bool   `json:"create_users"`
}

func loadLDAPConfig(app core.App) (*core.Record, ldapConfig, error) {
	record, err := app.FindRecordById(ldapConfigCollection, ldapConfigID)
	if err != nil {
		return nil, ldapConfig{}, err
	}
	return record, ldapConfig{
		Enabled:        record.GetBool("enabled"),
		URL:            record.GetString("url"),
		StartTLS:       record.GetBool("start_tls"),
		SkipVerify:     record.GetBool("skip_verify"),
		BindDN:         record.GetString("bind_dn"),
		BindPassword:   record.GetString("bind_password"),
		BaseDN:         record.GetString("base_dn"),
		UserFilter:     record.GetString("user_filter"),
		EmailAttribute: record.GetString("email_attribute"),
		AdminGroup:     record.GetString("admin_group"),
		UsersGroup:     record.GetString("users_group"),
		ReadonlyGroup:  record.GetString("readonly_group"),
		CreateUsers:    record.GetBool("create_users"),
	}, nil
}

// dial connects to the directory, with StartTLS when asked.
func (c ldapConfig) dial() (*ldap.Conn, error) {
	parsed, err := url.Parse(c.URL)
	if err != nil || (parsed.Scheme != "ldap" && parsed.Scheme != "ldaps") || parsed.Host == "" {
		return nil, errors.New("invalid directory URL, such as ldaps://dc.example.com:636")
	}
	tlsConfig := &tls.Config{ServerName: parsed.Hostname(), InsecureSkipVerify: c.SkipVerify}
	conn, err := ldap.DialURL(c.URL, ldap.DialWithDialer(&net.Dialer{Timeout: ldapTimeout}), ldap.DialWithTLSConfig(tlsConfig))
	if err != nil {
		return nil, err
	}
	conn.SetTimeout(ldapTimeout)
	if c.StartTLS && parsed.Scheme == "ldap" {
		if err := conn.StartTLS(tlsConfig); err != nil {
			conn.Close()
			return nil, err
		}
	}
	return conn, nil
}

// ldapUser is a user found in the directory.
type ldapUser struct {
	DN    string `json:"dn"`
	Email string `json:"email"`
	Name  string `json:"name"`
	Role  string `json:"role"`
}

var errLDAPDenied = errors.New("invalid credentials")

// authenticate finds the user, checks their password and returns their role
// (admin, user or readonly); errLDAPDenied when they can't log in.
func (c ldapConfig) authenticate(username, password string) (ldapUser, error) {
	username = strings.TrimSpace(username)
	if username == "" || password == "" {
		return ldapUser{}, errLDAPDenied
	}
	conn, err := c.dial()
	if err != nil {
		return ldapUser{}, err
	}
	defer conn.Close()
	if c.BindDN != "" {
		err = conn.Bind(c.BindDN, c.BindPassword)
	} else {
		err = conn.UnauthenticatedBind("")
	}
	if err != nil {
		return ldapUser{}, fmt.Errorf("service account: %w", err)
	}
	emailAttr := c.EmailAttribute
	if emailAttr == "" {
		emailAttr = "mail"
	}
	filter := strings.ReplaceAll(c.UserFilter, "{username}", ldap.EscapeFilter(username))
	result, err := conn.Search(ldap.NewSearchRequest(c.BaseDN, ldap.ScopeWholeSubtree, ldap.NeverDerefAliases, 2, int(ldapTimeout/time.Second), false,
		filter, []string{emailAttr, "displayName", "cn", "memberOf"}, nil))
	if err != nil {
		return ldapUser{}, fmt.Errorf("search: %w", err)
	}
	if len(result.Entries) != 1 {
		return ldapUser{}, errLDAPDenied
	}
	entry := result.Entries[0]
	user := ldapUser{DN: entry.DN, Email: strings.ToLower(strings.TrimSpace(entry.GetAttributeValue(emailAttr)))}
	if user.Name = entry.GetAttributeValue("displayName"); user.Name == "" {
		user.Name = entry.GetAttributeValue("cn")
	}
	// the password, by binding as the user
	if err := conn.Bind(entry.DN, password); err != nil {
		return ldapUser{}, errLDAPDenied
	}
	// the groups, with the service account again
	if c.BindDN != "" {
		_ = conn.Bind(c.BindDN, c.BindPassword)
	}
	member := func(group string) bool { return c.isMember(conn, entry, group) }
	switch {
	case c.AdminGroup != "" && member(c.AdminGroup):
		user.Role = "admin"
	case c.ReadonlyGroup != "" && member(c.ReadonlyGroup):
		user.Role = "readonly"
	case c.UsersGroup == "" || member(c.UsersGroup):
		user.Role = "user"
	default:
		return user, errLDAPDenied
	}
	if user.Email == "" {
		return user, errors.New("the directory account has no email address")
	}
	return user, nil
}

// isMember tells whether an entry is in a group, directly or through nested groups (Active Directory).
func (c ldapConfig) isMember(conn *ldap.Conn, entry *ldap.Entry, group string) bool {
	for _, dn := range entry.GetAttributeValues("memberOf") {
		if strings.EqualFold(dn, group) {
			return true
		}
	}
	filter := fmt.Sprintf("(memberOf:%s:=%s)", ldapInChain, ldap.EscapeFilter(group))
	result, err := conn.Search(ldap.NewSearchRequest(entry.DN, ldap.ScopeBaseObject, ldap.NeverDerefAliases, 1, int(ldapTimeout/time.Second), false,
		filter, []string{"dn"}, nil))
	return err == nil && len(result.Entries) == 1
}

// ldapFailures throttles the failed directory logins of each address.
type ldapFailures struct {
	sync.Mutex
	byIP map[string][]time.Time
}

func (f *ldapFailures) blocked(ip string, now time.Time) bool {
	f.Lock()
	defer f.Unlock()
	recent := f.byIP[ip][:0]
	for _, at := range f.byIP[ip] {
		if now.Sub(at) < ldapFailWindow {
			recent = append(recent, at)
		}
	}
	f.byIP[ip] = recent
	return len(recent) >= ldapMaxFailures
}

func (f *ldapFailures) add(ip string, now time.Time) {
	f.Lock()
	defer f.Unlock()
	if f.byIP == nil {
		f.byIP = map[string][]time.Time{}
	}
	f.byIP[ip] = append(f.byIP[ip], now)
}

var ldapLoginFailures = ldapFailures{byIP: map[string][]time.Time{}}

// ldapStatus tells the login form whether the directory login is offered.
func (h *Hub) ldapStatus(e *core.RequestEvent) error {
	_, config, _ := loadLDAPConfig(e.App)
	return e.JSON(http.StatusOK, map[string]bool{"enabled": config.Enabled && config.URL != ""})
}

// authWithLDAP logs in a user of the directory.
func (h *Hub) authWithLDAP(e *core.RequestEvent) error {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("", err)
	}
	ip := e.RealIP()
	now := time.Now()
	if ldapLoginFailures.blocked(ip, now) {
		return e.TooManyRequestsError("Too many failed logins, try again later.", nil)
	}
	_, config, err := loadLDAPConfig(e.App)
	if err != nil || !config.Enabled {
		return e.ForbiddenError("The directory login is not enabled.", nil)
	}
	user, err := config.authenticate(body.Username, body.Password)
	if err != nil {
		ldapLoginFailures.add(ip, now)
		h.logAuthFailure(e, body.Username, "ldap")
		if !errors.Is(err, errLDAPDenied) {
			e.App.Logger().Warn("Directory login failed", "username", body.Username, "err", err)
		}
		return e.BadRequestError("Failed to authenticate.", nil)
	}

	record, err := e.App.FindAuthRecordByEmail("users", user.Email)
	switch {
	case err == nil:
		// users of the directory follow its groups; local users keep their role
		if record.GetBool("ldap") && record.GetString("role") != user.Role {
			record.Set("role", user.Role)
			if err := e.App.Save(record); err != nil {
				return e.InternalServerError("", err)
			}
		}
	case !config.CreateUsers:
		ldapLoginFailures.add(ip, now)
		h.logAuthFailure(e, body.Username, "ldap")
		return e.BadRequestError("Failed to authenticate.", nil)
	default:
		collection, err := e.App.FindCollectionByNameOrId("users")
		if err != nil {
			return e.InternalServerError("", err)
		}
		record = core.NewRecord(collection)
		record.SetEmail(user.Email)
		record.SetVerified(true)
		record.SetRandomPassword()
		username := usernameFor(user)
		if existing, _ := e.App.FindFirstRecordByData("users", "username", username); existing != nil {
			username += "_" + security.RandomStringWithAlphabet(4, "0123456789")
		}
		record.Set("username", username)
		record.Set("role", user.Role)
		record.Set("ldap", true)
		if err := e.App.Save(record); err != nil {
			return e.InternalServerError("", err)
		}
	}
	return apis.RecordAuthResponse(e, record, "ldap", nil)
}

// usernameFor is the username of a new directory user: letters, digits and _ only.
func usernameFor(user ldapUser) string {
	name := strings.Split(user.Email, "@")[0]
	var b strings.Builder
	for _, r := range strings.ToLower(name) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' {
			b.WriteRune(r)
		}
	}
	if b.Len() < 3 {
		return "user_" + security.RandomStringWithAlphabet(6, "abcdefghijklmnopqrstuvwxyz0123456789")
	}
	return b.String()
}

// getLDAPConfig returns the directory settings to the admins, without the bind password.
func (h *Hub) getLDAPConfig(e *core.RequestEvent) error {
	_, config, err := loadLDAPConfig(e.App)
	if err != nil {
		return e.NotFoundError("", err)
	}
	hasPassword := config.BindPassword != ""
	config.BindPassword = ""
	return e.JSON(http.StatusOK, map[string]any{"config": config, "hasPassword": hasPassword})
}

// readLDAPBody reads the settings posted by an admin; an empty bind password keeps the saved one.
func readLDAPBody(e *core.RequestEvent) (*core.Record, ldapConfig, error) {
	record, saved, err := loadLDAPConfig(e.App)
	if err != nil {
		return nil, ldapConfig{}, err
	}
	var config ldapConfig
	if err := e.BindBody(&config); err != nil {
		return nil, ldapConfig{}, err
	}
	if config.BindPassword == "" {
		config.BindPassword = saved.BindPassword
	}
	if config.UserFilter != "" && !strings.Contains(config.UserFilter, "{username}") {
		return nil, ldapConfig{}, errors.New("the user filter must contain {username}")
	}
	return record, config, nil
}

// saveLDAPConfig saves the directory settings (admins).
func (h *Hub) saveLDAPConfig(e *core.RequestEvent) error {
	record, config, err := readLDAPBody(e)
	if err != nil {
		return e.BadRequestError(err.Error(), nil)
	}
	record.Load(map[string]any{
		"enabled": config.Enabled, "url": strings.TrimSpace(config.URL), "start_tls": config.StartTLS,
		"skip_verify": config.SkipVerify, "bind_dn": strings.TrimSpace(config.BindDN), "bind_password": config.BindPassword,
		"base_dn": strings.TrimSpace(config.BaseDN), "user_filter": strings.TrimSpace(config.UserFilter),
		"email_attribute": strings.TrimSpace(config.EmailAttribute), "admin_group": strings.TrimSpace(config.AdminGroup),
		"users_group": strings.TrimSpace(config.UsersGroup), "readonly_group": strings.TrimSpace(config.ReadonlyGroup),
		"create_users": config.CreateUsers,
	})
	if err := e.App.Save(record); err != nil {
		return e.InternalServerError("", err)
	}
	writeAudit(e, auditEntry{user: e.Auth, action: "update", targetType: "ldap_config", targetName: config.URL,
		details: map[string]any{"enabled": config.Enabled}})
	return h.getLDAPConfig(e)
}

// testLDAPConfig checks the settings being edited: the service account, and a
// user login when a username and password are given (admins).
func (h *Hub) testLDAPConfig(e *core.RequestEvent) error {
	_, config, err := readLDAPBody(e)
	if err != nil {
		return e.BadRequestError(err.Error(), nil)
	}
	var test struct {
		Username     string `json:"test_username"`
		TestPassword string `json:"test_password"`
	}
	_ = e.BindBody(&test)
	if test.Username == "" {
		conn, err := config.dial()
		if err == nil {
			if config.BindDN != "" {
				err = conn.Bind(config.BindDN, config.BindPassword)
			}
			conn.Close()
		}
		if err != nil {
			return e.JSON(http.StatusOK, map[string]string{"error": err.Error()})
		}
		return e.JSON(http.StatusOK, map[string]string{"status": "ok"})
	}
	user, err := config.authenticate(test.Username, test.TestPassword)
	if err != nil {
		return e.JSON(http.StatusOK, map[string]any{"error": err.Error(), "user": user})
	}
	return e.JSON(http.StatusOK, map[string]any{"status": "ok", "user": user})
}
