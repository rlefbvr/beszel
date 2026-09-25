package alerts

import (
	"bytes"
	_ "embed"
	"fmt"
	"html/template"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/pocketbase/dbx"
)

//go:embed templates/email.html
var emailTemplateHTML string

// emailIcon is the hub's icon.svg rendered to PNG: email clients such as
// Outlook and Gmail don't display SVG images.
//
//go:embed templates/icon.png
var emailIcon []byte

var emailTemplate = template.Must(template.New("email").Parse(emailTemplateHTML))

// messageMaxChars caps the plain text body of webhooks and emails.
const messageMaxChars = 1800

// AlertStatus sets the color, label and emoji of a notification.
type AlertStatus uint8

const (
	AlertStatusInfo AlertStatus = iota
	AlertStatusTriggered
	AlertStatusWarning
	AlertStatusResolved
)

// AlertDetail is an extra block below the message, such as a log excerpt.
type AlertDetail struct {
	Label Msg
	// Text is shown preformatted and is not translated.
	Text string
}

type AlertMessageData struct {
	UserID     string
	SystemID   string
	SystemName string
	Title      Msg
	Message    Msg
	// Target is what the alert is about (a service, container, disk...),
	// highlighted in emails under TargetLabel.
	Target      Msg
	TargetLabel Msg
	Details     []AlertDetail
	Status      AlertStatus
	// Emoji is appended to the webhook title.
	Emoji    string
	Link     string
	LinkText Msg
}

// viewSystemLink is the link label for a system.
func viewSystemLink(systemName string) Msg {
	return M("link.view_system", Args{"system": systemName})
}

// renderedNotification is a notification translated into one language.
type renderedNotification struct {
	Lang          string
	Dir           string
	Start, End    string // "left"/"right", swapped for right-to-left languages
	Subject       string
	WebhookTitle  string
	Preheader     string
	Title         string
	Message       string
	MessageHTML   template.HTML
	Target        string
	TargetLabel   string
	Details       []renderedDetail
	StatusLabel   string
	Pill          template.HTML
	SystemName    string
	Link          string
	LinkText      string
	Button        template.HTML
	AppURL        string
	AppHost       string
	Footer        string
	SettingsLink  string
	SettingsLabel string
	MsoHead       template.HTML

	// message and translator render webhook bodies with markup per service
	message    Msg
	translator Translator
}

type renderedDetail struct {
	Label string
	Text  string
}

var rtlLangs = map[string]bool{"ar": true, "fa": true, "he": true}

// Arguments highlighted in the HTML message: names in bold and technical
// values (states, health) as code, which also keeps translations neutral.
var (
	highlightNames  = map[string]bool{"system": true, "target": true, "container": true, "containers": true, "device": true, "pool": true, "services": true, "items": true, "sensor": true, "disk": true}
	highlightValues = map[string]bool{"state": true, "states": true, "health": true, "previous": true}
)

func highlightArg(name string, value template.HTML) template.HTML {
	switch {
	case highlightNames[name]:
		return template.HTML(`<strong class="fg" style="font-weight:600;color:#1d1d20;">`) + value + `</strong>`
	case highlightValues[name]:
		return template.HTML(`<code class="code" style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;background:#f3f1ef;border:1px solid #e7e3df;border-radius:5px;padding:1px 5px;color:#1d1d20;white-space:nowrap;">`) + value + `</code>`
	}
	return value
}

type statusStyle struct {
	key, color, background string
}

var statusStyles = map[AlertStatus]statusStyle{
	AlertStatusInfo:      {"email.status.info", "#5b5856", "#efedeb"},
	AlertStatusTriggered: {"email.status.triggered", "#c42f2f", "#fde8e8"},
	AlertStatusWarning:   {"email.status.warning", "#b45309", "#fdf0dc"},
	AlertStatusResolved:  {"email.status.resolved", "#15803d", "#e3f5ea"},
}

// Classic Outlook for Windows renders with Word, which ignores border-radius
// and the padding of inline elements, so the pill and the button are also drawn
// as VML shapes inside [if mso] comments, which every other client ignores.
// The regular elements carry mso-hide:all so classic Outlook shows only the VML.
// Content is never hidden behind [if !mso] comments: the new Outlook drops it.
// html/template strips comments from the template itself, so they are inserted
// from here.
const msoHead = `<!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->`

func pillHTML(label string, style statusStyle) template.HTML {
	text := template.HTMLEscapeString(label)
	width := utf8.RuneCountInString(label)*7 + 36
	return template.HTML(fmt.Sprintf(
		`<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" style="height:24px;width:%dpx;v-text-anchor:middle;" arcsize="50%%" fillcolor="%s" stroke="f"><v:textbox inset="0,0,0,0"><center style="color:%s;font-family:Arial,sans-serif;font-size:12px;font-weight:bold;">&#9679;&nbsp;%s</center></v:textbox></v:roundrect><![endif]-->`+
			`<span style="mso-hide:all;display:inline-block;background:%s;color:%s;border-radius:999px;padding:4px 12px 4px 10px;font-size:12px;line-height:16px;font-weight:600;white-space:nowrap;">&#9679;&nbsp;%s</span>`,
		width, style.background, style.color, text, style.background, style.color, text))
}

func buttonHTML(link, label string) template.HTML {
	href := template.HTMLEscapeString(link)
	text := template.HTMLEscapeString(label)
	width := max(160, utf8.RuneCountInString(label)*9+48)
	return template.HTML(fmt.Sprintf(
		`<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="%s" style="height:42px;width:%dpx;v-text-anchor:middle;" arcsize="22%%" fillcolor="#18181b" stroke="f"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;">%s</center></v:roundrect><![endif]-->`+
			`<a class="btn" href="%s" style="mso-hide:all;display:inline-block;background:#18181b;color:#ffffff;font-size:14px;font-weight:600;line-height:20px;padding:11px 20px;border-radius:10px;text-decoration:none;">%s</a>`,
		href, width, text, href, text))
}

func (data AlertMessageData) render(t Translator, appURL, settingsLink string) renderedNotification {
	style := statusStyles[data.Status]
	r := renderedNotification{
		Lang:          t.Lang(),
		Dir:           "ltr",
		Start:         "left",
		End:           "right",
		Title:         t.T(data.Title),
		Message:       t.T(data.Message),
		MessageHTML:   t.HTML(data.Message, highlightArg),
		Target:        t.T(data.Target),
		TargetLabel:   t.T(data.TargetLabel),
		StatusLabel:   t.T(M(style.key, nil)),
		SystemName:    data.SystemName,
		Link:          data.Link,
		LinkText:      t.T(data.LinkText),
		AppURL:        appURL,
		AppHost:       appHost(appURL),
		Footer:        t.T(M("email.footer", nil)),
		SettingsLink:  settingsLink,
		SettingsLabel: t.T(M("email.settings", nil)),
		MsoHead:       msoHead,
		message:       data.Message,
		translator:    t,
	}
	if rtlLangs[r.Lang] {
		r.Dir, r.Start, r.End = "rtl", "right", "left"
	}
	r.Pill = pillHTML(r.StatusLabel, style)
	r.WebhookTitle = r.Title
	if data.Emoji != "" {
		r.WebhookTitle += " " + data.Emoji
	}
	r.Subject = r.Title
	if data.Status != AlertStatusInfo {
		r.Subject = "[" + r.StatusLabel + "] " + r.Title
	}
	r.Preheader = r.Message
	if r.LinkText == "" && r.Link != "" {
		r.LinkText = r.Link
	}
	if r.Link != "" {
		r.Button = buttonHTML(r.Link, r.LinkText)
	}
	for _, detail := range data.Details {
		r.Details = append(r.Details, renderedDetail{Label: t.T(detail.Label), Text: detail.Text})
	}
	return r
}

// appHost returns the host (and path) of the hub URL for display.
func appHost(appURL string) string {
	u, err := url.Parse(appURL)
	if err != nil || u.Host == "" {
		return ""
	}
	return strings.TrimSuffix(u.Host+u.Path, "/")
}

// webhookBold is the bold markup of the webhook services that render markdown.
// Other services receive plain text, which would otherwise show the markers.
var webhookBold = map[string]string{
	"discord":    "**",
	"mattermost": "**",
	"rocketchat": "**",
	"teams":      "**",
	"zulip":      "**",
	"googlechat": "*",
	"slack":      "*",
}

// plainText is the text part of emails and the body of webhooks without markup.
func (r renderedNotification) plainText() string {
	return r.withDetails(r.Message)
}

// webhookText is the webhook body for a service scheme, with names in bold
// when the service renders markdown.
func (r renderedNotification) webhookText(scheme string) string {
	bold, ok := webhookBold[scheme]
	if !ok {
		return r.plainText()
	}
	return r.withDetails(r.translator.Markup(r.message, func(name, value string) string {
		if highlightNames[name] && value != "" {
			return bold + value + bold
		}
		return value
	}))
}

// withDetails appends the details to a message as fenced blocks.
func (r renderedNotification) withDetails(message string) string {
	var body strings.Builder
	body.WriteString(message)
	for _, detail := range r.Details {
		body.WriteString("\n\n")
		body.WriteString(detail.Label)
		if detail.Text != "" {
			body.WriteString("\n```\n")
			body.WriteString(detail.Text)
			body.WriteString("\n```")
		}
	}
	text := body.String()
	if len(text) > messageMaxChars {
		text = text[:messageMaxChars] + "\n…(truncated)"
	}
	return text
}

func (r renderedNotification) html() (string, error) {
	var buf bytes.Buffer
	if err := emailTemplate.Execute(&buf, r); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// userLang returns a user's interface language, or "" when unknown.
func (am *AlertManager) userLang(userID string) string {
	record, err := am.hub.FindFirstRecordByFilter("user_settings", "user={:user}", dbx.Params{"user": userID})
	if err != nil {
		return ""
	}
	var settings UserNotificationSettings
	_ = record.UnmarshalJSONField("settings", &settings)
	return settings.Lang
}
