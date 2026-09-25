import { t } from "@lingui/core/macro"
import PocketBase from "pocketbase"
import { basePath } from "@/components/router"
import { toast } from "@/components/ui/use-toast"
import { dynamicActivate, getLocale } from "@/lib/i18n"
import type { ChartTimes, UserSettings } from "@/types"
import {
	$agentInstallDir,
	$agentServiceName,
	$alerts,
	$alertsRetention,
	$allSystemsById,
	$allSystemsByName,
	$servicesInterval,
	$userSettings,
} from "./stores"
import { chartTimeData, debounce } from "./utils"

/** PocketBase JS Client */
export const pb = new PocketBase(basePath)

export const isAdmin = () => pb.authStore.record?.role === "admin"
export const isReadOnlyUser = () => pb.authStore.record?.role === "readonly"

const verifyAuth = () => {
	pb.collection("users")
		.authRefresh()
		.catch(() => {
			logOut()
			toast({
				title: t`Failed to authenticate`,
				description: t`Please log in again`,
				variant: "destructive",
			})
		})
}

const verifyAuthDebounced = debounce(verifyAuth, 100)

// verify the session whenever any API request returns a 4xx response (e.g. an
// expired JWT). The auth-refresh endpoint is excluded to avoid a loop, since
// it returns 401 itself when the token is no longer valid.
pb.afterSend = (response, data) => {
	if (
		(response.status === 401 || response.status === 403) &&
		pb.authStore.token &&
		!response.url.includes("auth-refresh")
	) {
		verifyAuthDebounced()
	}
	return data
}

/** Logs the user out by clearing the auth store and unsubscribing from realtime updates. */
export function logOut() {
	$allSystemsByName.set({})
	$allSystemsById.set({})
	$alerts.set({})
	$userSettings.set({} as UserSettings)
	sessionStorage.setItem("lo", "t") // prevent auto login on logout
	pb.authStore.clear()
	pb.realtime.unsubscribe()
}

/** Save a partial update to user settings in database immediately */
export async function saveUserSettings(newSettings: Partial<UserSettings>) {
	// get fresh copy of settings so concurrent changes aren't overwritten
	const req = await pb.collection("user_settings").getFirstListItem("", { fields: "id,settings" })
	const updatedSettings = await pb.collection("user_settings").update(req.id, {
		settings: {
			...req.settings,
			...newSettings,
		},
	})
	$userSettings.set(updatedSettings.settings)
}

// keys queued by queueUserSettings, flushed together in a single request so that
// two debounced saves for different keys can't race each other's read-modify-write
// and silently drop one of the changes
let queuedSettings: Partial<UserSettings> = {}

const flushQueuedSettings = debounce(() => {
	const toSave = queuedSettings
	queuedSettings = {}
	if (Object.keys(toSave).length === 0) {
		return
	}
	saveUserSettings(toSave).catch(console.error)
}, 1000)

/** Queue a partial user settings update, merging with any other pending keys and saving them together after a debounce window */
export function queueUserSettings(newSettings: Partial<UserSettings>) {
	queuedSettings = { ...queuedSettings, ...newSettings }
	flushQueuedSettings()
}

/** Id of the single hub_settings record created by migration */
const hubSettingsId = "hubsettings0000"

/** Fetch hub-wide settings */
export async function updateHubSettings() {
	try {
		const settings = await pb
			.collection("hub_settings")
			.getOne(hubSettingsId, {
				fields: "services_interval,agent_service_name,agent_install_dir,alerts_retention_count,alerts_retention_days",
			})
		$servicesInterval.set(settings.services_interval)
		if (settings.agent_service_name) {
			$agentServiceName.set(settings.agent_service_name)
		}
		$agentInstallDir.set(settings.agent_install_dir ?? "")
		$alertsRetention.set({ count: settings.alerts_retention_count || 200, days: settings.alerts_retention_days ?? 0 })
	} catch (e) {
		console.error("get hub settings", e)
	}
}

/** Save the service collection interval in minutes (admins only) */
export async function saveServicesInterval(minutes: number) {
	const settings = await pb.collection("hub_settings").update(hubSettingsId, { services_interval: minutes })
	$servicesInterval.set(settings.services_interval)
}

/** Save the name of the agent service used by the install commands (admins only) */
export async function saveAgentServiceName(name: string) {
	const settings = await pb.collection("hub_settings").update(hubSettingsId, { agent_service_name: name })
	$agentServiceName.set(settings.agent_service_name)
}

/** Save the folder the Windows install command installs the agent to (admins only) */
export async function saveAgentInstallDir(dir: string) {
	const settings = await pb.collection("hub_settings").update(hubSettingsId, { agent_install_dir: dir })
	$agentInstallDir.set(settings.agent_install_dir ?? "")
}

/** Save the retention of the alert history: days > 0 keeps the alerts of those days, else count alerts per user (admins only) */
export async function saveAlertsRetention(count: number, days: number) {
	const settings = await pb
		.collection("hub_settings")
		.update(hubSettingsId, { alerts_retention_count: count, alerts_retention_days: days })
	$alertsRetention.set({ count: settings.alerts_retention_count, days: settings.alerts_retention_days })
}

/** Fetch or create user settings in database */
export async function updateUserSettings() {
	try {
		const req = await pb.collection("user_settings").getFirstListItem("", { fields: "settings" })
		$userSettings.set(req.settings)
		dynamicActivate(req.settings.lang || getLocale())
		// remember the detected language so notifications from the hub use it
		if (!req.settings.lang) {
			queueUserSettings({ lang: getLocale() })
		}
		return
	} catch (e) {
		console.error("get settings", e)
	}
	// create user settings if error fetching existing
	try {
		const createdSettings = await pb.collection("user_settings").create({ user: pb.authStore.record?.id })
		$userSettings.set(createdSettings.settings)
		dynamicActivate(createdSettings.settings.lang || getLocale())
		if (!createdSettings.settings.lang) {
			queueUserSettings({ lang: getLocale() })
		}
	} catch (e) {
		console.error("create settings", e)
	}
}

export function getPbTimestamp(timeString: ChartTimes, d?: Date, createdIsNumber?: boolean) {
	d ||= chartTimeData[timeString].getOffset(new Date())
	if (createdIsNumber) {
		return d.getTime()
	}
	const year = d.getUTCFullYear()
	const month = String(d.getUTCMonth() + 1).padStart(2, "0")
	const day = String(d.getUTCDate()).padStart(2, "0")
	const hours = String(d.getUTCHours()).padStart(2, "0")
	const minutes = String(d.getUTCMinutes()).padStart(2, "0")
	const seconds = String(d.getUTCSeconds()).padStart(2, "0")

	return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}
