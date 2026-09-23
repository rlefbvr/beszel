//go:build testing

package alerts_test

import (
	"testing"

	"github.com/henrygd/beszel/internal/alerts"
	"github.com/henrygd/beszel/internal/entities/systemd"
	"github.com/pocketbase/dbx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAlertEmailTranslatedHTML(t *testing.T) {
	hub, system, alert := systemdTestSetup(t, false)
	defer hub.Cleanup()

	settings, err := hub.FindFirstRecordByFilter("user_settings", "user={:user}", dbx.Params{"user": alert.GetString("user")})
	require.NoError(t, err)
	settings.Set("settings", `{"emails":["test@example.com"],"webhooks":[],"lang":"fr"}`)
	require.NoError(t, hub.Save(settings))

	am := alerts.NewTestAlertManagerWithoutWorker(hub)
	seedServices(t, hub, system.Id, systemd.StatusFailed)
	require.NoError(t, am.HandleSystemdAlerts(system))

	message := hub.TestMailer.LastMessage()
	assert.Contains(t, message.Subject, "[Alerte] Services en échec sur")
	assert.Contains(t, message.Text, "1 service en échec")
	assert.Contains(t, message.HTML, `lang="fr"`)
	assert.Contains(t, message.HTML, "Services en échec sur")
	assert.Contains(t, message.HTML, "a.service")
	assert.Contains(t, message.HTML, "Alerte</span>")
	assert.Contains(t, message.HTML, ">Services en échec</div>", "failed services are highlighted")
	assert.Contains(t, message.InlineAttachments, "beszel-icon.png")
}
