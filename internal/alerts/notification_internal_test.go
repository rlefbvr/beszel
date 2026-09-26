//go:build testing

package alerts

import (
	"encoding/json"
	"regexp"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCatalogsHaveEveryKey(t *testing.T) {
	placeholder := regexp.MustCompile(`\{(\w+)\}`)
	names := func(e catalogEntry) map[string]bool {
		found := map[string]bool{}
		texts := []string{e.text}
		for _, text := range e.plural {
			texts = append(texts, text)
		}
		for _, text := range texts {
			for _, m := range placeholder.FindAllStringSubmatch(text, -1) {
				found[m[1]] = true
			}
		}
		delete(found, "count") // plural forms may spell out the number
		return found
	}
	en := loadCatalogs()[defaultLang]
	require.NotEmpty(t, en)
	for _, lang := range catalogLanguages() {
		catalog := loadCatalogs()[lang]
		for key, entry := range en {
			translated, ok := catalog[key]
			if assert.True(t, ok, "%s: missing %s", lang, key) {
				assert.Equal(t, names(entry), names(translated), "%s: placeholders of %s", lang, key)
			}
		}
	}
}

func TestTranslatorEnglishMatchesPreviousTexts(t *testing.T) {
	tr := NewTranslator("")
	assert.Equal(t, "en", tr.Lang())
	assert.Equal(t, "Connection to web is down", tr.T(M("status.down", Args{"system": "web"})))
	assert.Equal(t, "web memory above threshold", tr.T(M("threshold.above", Args{"system": "web", "metric": M("metric.title.Memory", nil)})))
	assert.Equal(t, "Disk usage averaged 91.50% for the previous 1 minute.",
		tr.T(M("threshold.body", Args{"descriptor": M("metric.Disk", nil), "value": 91.5, "unit": "%", "count": 1})))
	assert.Equal(t, "Usage of /mnt averaged 3.00% for the previous 5 minutes.",
		tr.T(M("threshold.body", Args{"descriptor": diskAlertDescriptor("/mnt"), "value": 3.0, "unit": "%", "count": 5})))
	assert.Equal(t, "a, b and 2 more", tr.T(M("list.more", Args{"items": []string{"a", "b"}, "count": 2})))
}

func TestTranslatorLanguages(t *testing.T) {
	fr := NewTranslator("fr")
	assert.Equal(t, "La connexion à web est interrompue", fr.T(M("status.down", Args{"system": "web"})))
	// decimal comma
	assert.Contains(t, fr.T(M("threshold.body", Args{"descriptor": M("metric.CPU", nil), "value": 91.5, "unit": "%", "count": 5})), "91,50%")

	// CLDR plural forms
	ru := NewTranslator("ru")
	body := func(n int) string {
		return ru.T(M("systemd.failed.body", Args{"system": "s", "count": n, "services": RawMsg("x")}))
	}
	assert.Contains(t, body(1), "сбойная служба")
	assert.Contains(t, body(3), "сбойные службы")
	assert.Contains(t, body(5), "сбойных служб")

	// regional variants fall back to the base language, unknown ones to English
	assert.Equal(t, "pt", NewTranslator("pt-BR").Lang())
	assert.Equal(t, "zh-CN", NewTranslator("zh-CN").Lang())
	assert.Equal(t, "en", NewTranslator("xx").Lang())

	// raw text and unknown keys are passed through
	assert.Equal(t, "literal", fr.T(RawMsg("literal")))
	assert.Equal(t, "missing.key", fr.T(M("missing.key", nil)))
}

func TestNotificationRendering(t *testing.T) {
	data := AlertMessageData{
		SystemName:  "web <1>",
		Title:       M("state.service.triggered.title", Args{"target": "api", "system": "web <1>", "state": "inactive (dead)"}),
		Message:     M("state.service.triggered.body", Args{"target": "api", "system": "web <1>", "state": "inactive (dead)", "rule": M("state.rule.is_not", Args{"states": "active"})}),
		Target:      RawMsg("api <svc>"),
		TargetLabel: M("target.service", nil),
		Details:     []AlertDetail{{Label: M("container.logs", Args{"container": "api"}), Text: "ERROR <boom>"}},
		Status:      AlertStatusTriggered,
		Emoji:       "🔴",
		Link:        "https://beszel.example/system/abc",
		LinkText:    viewSystemLink("web <1>"),
	}

	en := data.render(NewTranslator("en"), "https://beszel.example", "https://beszel.example/settings/notifications")
	assert.Equal(t, "[Alert] Service api on web <1>: inactive (dead)", en.Subject)
	assert.Equal(t, "Service api on web <1>: inactive (dead) 🔴", en.WebhookTitle, "webhooks keep the emoji and no prefix")
	assert.Equal(t, "Service api on web <1> is inactive (dead). Rule: state is not active.\n\napi logs:\n```\nERROR <boom>\n```", en.plainText())
	assert.Equal(t, "Service **api** on **web <1>** is inactive (dead). Rule: state is not active.\n\napi logs:\n```\nERROR <boom>\n```", en.webhookText("teams"), "names are bold for markdown services")
	assert.Equal(t, "Service *api* on *web <1>* is inactive (dead). Rule: state is not active.\n\napi logs:\n```\nERROR <boom>\n```", en.webhookText("slack"))
	assert.Equal(t, en.plainText(), en.webhookText("ntfy"), "other services get plain text")

	html, err := en.html()
	require.NoError(t, err)
	assert.Contains(t, html, `lang="en" dir="ltr"`)
	assert.Contains(t, html, "Service api on web &lt;1&gt;: inactive (dead)", "values must be escaped")
	assert.Contains(t, html, "api &lt;svc&gt;", "target is highlighted")
	assert.Contains(t, html, ">Service</div>")
	assert.Contains(t, html, `<strong class="fg"`, "names are highlighted in the message")
	assert.Contains(t, html, `<code class="code"`, "states are shown as code")
	assert.Contains(t, html, "ERROR &lt;boom&gt;")
	assert.Contains(t, html, `href="https://beszel.example/system/abc"`)
	assert.Contains(t, html, "View web &lt;1&gt;")
	assert.Contains(t, html, "cid:beszel-icon.png")
	assert.Contains(t, html, `width="28" height="35"`)
	assert.Contains(t, html, ">beszel.example</a>", "the header shows the hub URL")
	assert.Contains(t, html, "https://beszel.example/settings/notifications")
	assert.Contains(t, html, "Alert</span>")
	assert.Contains(t, html, "<v:roundrect", "Outlook gets VML shapes")
	assert.Contains(t, html, "<!--[if mso]>", "conditional comments are kept")
	assert.NotContains(t, html, "[if !mso]", "the new Outlook drops content hidden behind !mso comments")
	assert.Contains(t, html, `style="mso-hide:all;`)
	assert.NotContains(t, html, "ZgotmplZ")
	assert.NotContains(t, html, "prefers-color-scheme", "the message follows the mail client theme, not the OS")
	assert.Contains(t, html, "[data-ogsb] .btn", "the button stays readable in Outlook dark mode")

	fr := data.render(NewTranslator("fr"), "", "")
	assert.Equal(t, "[Alerte] Service api sur web <1> : inactive (dead)", fr.Subject)
	assert.Contains(t, fr.Message, "est dans l’état inactive (dead)")
	html, err = fr.html()
	require.NoError(t, err)
	assert.Contains(t, html, ">Beszel<", "without an app URL the header shows the product name")
	assert.NotContains(t, html, "settings/notifications")

	ar := data.render(NewTranslator("ar"), "", "")
	html, err = ar.html()
	require.NoError(t, err)
	assert.Contains(t, html, `lang="ar" dir="rtl"`)
	assert.Contains(t, html, "padding-left:10px", "spacing is mirrored for right-to-left languages")

	resolved := AlertMessageData{Title: RawMsg("t"), Message: RawMsg("m"), Status: AlertStatusResolved}
	assert.Equal(t, "[Résolu] t", resolved.render(NewTranslator("fr"), "", "").Subject)
	info := AlertMessageData{Title: RawMsg("t"), Message: RawMsg("m")}
	assert.Equal(t, "t", info.render(NewTranslator("en"), "", "").Subject)
}

func TestWebhookScheme(t *testing.T) {
	assert.Equal(t, "teams", webhookScheme("teams://example.com/webhook?title=x"))
	assert.Equal(t, "discord", webhookScheme("Discord://token@id"))
	assert.Equal(t, "", webhookScheme("not a url"))
}

func TestEmailBrand(t *testing.T) {
	assert.Equal(t, "Monitoring", emailBrand("name", " Monitoring ", "https://beszel.example.com"))
	assert.Equal(t, "beszel.example.com", emailBrand("url", "Monitoring", "https://beszel.example.com/"))
	assert.Equal(t, "Beszel", emailBrand("none", "Monitoring", "https://beszel.example.com"))
	assert.Equal(t, "Beszel", emailBrand("", "Monitoring", "https://beszel.example.com"), "no label chosen")
	assert.Equal(t, "Beszel", emailBrand("url", "Monitoring", ""), "no URL")
	assert.Equal(t, "Beszel", emailBrand("name", "", ""), "no name")

	data := AlertMessageData{Title: M("t", nil), Status: AlertStatusInfo}
	rendered := data.render(NewTranslator("en"), "https://beszel.example", "")
	rendered.Brand = emailBrand("name", "Monitoring", "https://beszel.example")
	html, err := rendered.html()
	require.NoError(t, err)
	assert.Contains(t, html, `href="https://beszel.example" style="color:#1a1a1a;text-decoration:none;">Monitoring</a>`, "the name links to the hub")
}

func TestAppHost(t *testing.T) {
	assert.Equal(t, "beszel.example.com", appHost("https://beszel.example.com/"))
	assert.Equal(t, "example.com/beszel", appHost("https://example.com/beszel/"))
	assert.Equal(t, "", appHost(""))
}

func TestNotificationPlainTextTruncated(t *testing.T) {
	data := AlertMessageData{Message: RawMsg(strings.Repeat("x", messageMaxChars+50))}
	text := data.render(NewTranslator("en"), "", "").plainText()
	assert.True(t, strings.HasSuffix(text, "…(truncated)"))
	assert.Len(t, text, messageMaxChars+len("\n…(truncated)"))
}

func TestUserNotificationSettingsLang(t *testing.T) {
	var settings UserNotificationSettings
	require.NoError(t, json.Unmarshal([]byte(`{"emails":["a@b.c"],"lang":"de"}`), &settings))
	assert.Equal(t, "de", settings.Lang)
}
