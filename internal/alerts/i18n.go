package alerts

import (
	"embed"
	"encoding/json"
	"fmt"
	"html/template"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"

	"golang.org/x/text/feature/plural"
	"golang.org/x/text/language"
)

// Notification texts are translated with the catalogs in locales/, one JSON file
// per interface language. An entry is a string, or an object of CLDR plural forms
// ("one", "few", "many", "other"...) selected by the "count" argument.
// Placeholders use the {name} of an argument.

//go:embed locales/*.json
var localesFS embed.FS

const defaultLang = "en"

// Args are the named arguments of a message.
type Args map[string]any

// Msg is a translatable notification text: a catalog key and its arguments.
// Raw is used as-is when set, for text that has no translation.
type Msg struct {
	Key  string
	Args Args
	Raw  string
}

// M returns a translatable message.
func M(key string, args Args) Msg {
	return Msg{Key: key, Args: args}
}

// RawMsg returns a message that is never translated.
func RawMsg(text string) Msg {
	return Msg{Raw: text}
}

// IsZero reports whether the message is empty.
func (m Msg) IsZero() bool {
	return m.Key == "" && m.Raw == ""
}

type catalogEntry struct {
	text   string
	plural map[string]string
}

func (e *catalogEntry) UnmarshalJSON(data []byte) error {
	if err := json.Unmarshal(data, &e.text); err == nil {
		return nil
	}
	return json.Unmarshal(data, &e.plural)
}

var (
	catalogsOnce sync.Once
	catalogs     map[string]map[string]catalogEntry
)

func loadCatalogs() map[string]map[string]catalogEntry {
	catalogsOnce.Do(func() {
		catalogs = map[string]map[string]catalogEntry{}
		files, _ := localesFS.ReadDir("locales")
		for _, file := range files {
			data, err := localesFS.ReadFile(path.Join("locales", file.Name()))
			if err != nil {
				continue
			}
			var entries map[string]catalogEntry
			if err := json.Unmarshal(data, &entries); err != nil {
				panic(fmt.Sprintf("invalid notification catalog %s: %v", file.Name(), err))
			}
			catalogs[strings.TrimSuffix(file.Name(), ".json")] = entries
		}
	})
	return catalogs
}

// catalogLanguages returns the languages with a catalog, sorted.
func catalogLanguages() []string {
	langs := make([]string, 0, len(loadCatalogs()))
	for lang := range loadCatalogs() {
		langs = append(langs, lang)
	}
	sort.Strings(langs)
	return langs
}

// normalizeLang maps a user language setting to a catalog, falling back to English.
func normalizeLang(lang string) string {
	all := loadCatalogs()
	if _, ok := all[lang]; ok {
		return lang
	}
	// "pt-BR" -> "pt"
	if base, _, ok := strings.Cut(lang, "-"); ok {
		if _, ok := all[base]; ok {
			return base
		}
	}
	return defaultLang
}

// Translator renders messages in one language.
type Translator struct {
	lang string
	tag  language.Tag
}

// NewTranslator returns a translator for a user language setting.
func NewTranslator(lang string) Translator {
	lang = normalizeLang(lang)
	return Translator{lang: lang, tag: language.Make(lang)}
}

// Lang returns the catalog language.
func (t Translator) Lang() string {
	return t.lang
}

func (t Translator) lookup(key string) (catalogEntry, bool) {
	all := loadCatalogs()
	if entry, ok := all[t.lang][key]; ok && (entry.text != "" || len(entry.plural) > 0) {
		return entry, true
	}
	entry, ok := all[defaultLang][key]
	return entry, ok
}

// T renders a message.
func (t Translator) T(m Msg) string {
	if m.Raw != "" || m.Key == "" {
		return m.Raw
	}
	text, ok := t.text(m)
	if !ok {
		return m.Key
	}
	return t.fill(text, m.Args)
}

// text returns the catalog text of a message, with its plural form selected.
func (t Translator) text(m Msg) (string, bool) {
	entry, ok := t.lookup(m.Key)
	if !ok {
		return "", false
	}
	if entry.plural != nil {
		return t.pluralForm(entry.plural, m.Args["count"]), true
	}
	return entry.text, true
}

var placeholderRe = regexp.MustCompile(`\{(\w+)\}`)

// HTML renders a message as escaped HTML. wrap may decorate an argument by
// name (for example to highlight a service name); it receives escaped HTML.
func (t Translator) HTML(m Msg, wrap func(name string, value template.HTML) template.HTML) template.HTML {
	if m.Raw != "" || m.Key == "" {
		return template.HTML(template.HTMLEscapeString(m.Raw))
	}
	text, ok := t.text(m)
	if !ok {
		return template.HTML(template.HTMLEscapeString(m.Key))
	}
	var b strings.Builder
	last := 0
	for _, loc := range placeholderRe.FindAllStringSubmatchIndex(text, -1) {
		b.WriteString(template.HTMLEscapeString(text[last:loc[0]]))
		name := text[loc[2]:loc[3]]
		value, ok := m.Args[name]
		if !ok {
			b.WriteString(template.HTMLEscapeString(text[loc[0]:loc[1]]))
		} else {
			var rendered template.HTML
			if nested, isMsg := value.(Msg); isMsg {
				rendered = t.HTML(nested, wrap)
			} else {
				rendered = template.HTML(template.HTMLEscapeString(t.format(value)))
			}
			if wrap != nil {
				rendered = wrap(name, rendered)
			}
			b.WriteString(string(rendered))
		}
		last = loc[1]
	}
	b.WriteString(template.HTMLEscapeString(text[last:]))
	return template.HTML(b.String())
}

func (t Translator) pluralForm(forms map[string]string, count any) string {
	n, _ := count.(int)
	form := "other"
	switch plural.Cardinal.MatchPlural(t.tag, n, 0, 0, 0, 0) {
	case plural.Zero:
		form = "zero"
	case plural.One:
		form = "one"
	case plural.Two:
		form = "two"
	case plural.Few:
		form = "few"
	case plural.Many:
		form = "many"
	}
	if text, ok := forms[form]; ok {
		return text
	}
	return forms["other"]
}

func (t Translator) fill(text string, args Args) string {
	if len(args) == 0 || !strings.Contains(text, "{") {
		return text
	}
	pairs := make([]string, 0, len(args)*2)
	for name, value := range args {
		pairs = append(pairs, "{"+name+"}", t.format(value))
	}
	return strings.NewReplacer(pairs...).Replace(text)
}

// commaDecimalLangs write decimals with a comma.
var commaDecimalLangs = map[string]bool{
	"bg": true, "cs": true, "da": true, "de": true, "el": true, "es": true, "fr": true, "hr": true,
	"hu": true, "id": true, "it": true, "nl": true, "no": true, "pl": true, "pt": true, "ru": true,
	"sl": true, "sr": true, "sv": true, "tr": true, "uk": true, "uz": true, "vi": true,
}

func (t Translator) format(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case Msg:
		return t.T(v)
	case int:
		return strconv.Itoa(v)
	case float64:
		s := strconv.FormatFloat(v, 'f', 2, 64)
		if commaDecimalLangs[t.lang] {
			s = strings.Replace(s, ".", ",", 1)
		}
		return s
	case []string:
		return strings.Join(v, ", ")
	default:
		return fmt.Sprint(v)
	}
}
