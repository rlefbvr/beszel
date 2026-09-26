import { atom } from "nanostores"
import { queueUserSettings } from "@/lib/api"
import { $router } from "@/components/router"
import { $allSystemsById, $userSettings } from "@/lib/stores"

/** Kinds of objects remembered as recently opened */
export type RecentKind = "system" | "sensor" | "container" | "service"

/** An object opened recently, listed first by the command palette */
export interface RecentItem {
	kind: RecentKind
	id: string
	/** name when opened; the palette shows the current name when it knows it */
	name: string
	/** system of a container or service */
	system?: string
}

/** Objects kept in the recent list */
const maxRecent = 10

/** Whether the user settings holding the list are loaded: saving before would erase it */
let settingsLoaded = false

/** Puts an object first in the recent list of the user (kept in the user settings) */
export function rememberRecent(item: RecentItem) {
	if (!settingsLoaded) {
		return
	}
	const current = $userSettings.get().recent ?? []
	const first = current[0]
	if (first && first.kind === item.kind && first.id === item.id && first.name === item.name) {
		return
	}
	const recent = [item, ...current.filter((other) => other.kind !== item.kind || other.id !== item.id)].slice(
		0,
		maxRecent
	)
	$userSettings.setKey("recent", recent)
	queueUserSettings({ recent })
}

/** A container or service whose details sheet its page should open once loaded */
export const $openRequest = atom<{ kind: "container" | "service"; id: string } | null>(null)

/** Remembers the systems whose page is opened, once the user settings are loaded; returns the function stopping it */
export function trackRecentSystems() {
	settingsLoaded = true
	return $router.subscribe((page) => {
		if (page?.route !== "system") {
			return
		}
		const system = $allSystemsById.get()[page.params.id]
		rememberRecent({ kind: "system", id: page.params.id, name: system?.name ?? "" })
	})
}
