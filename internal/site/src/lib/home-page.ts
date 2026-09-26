import { t } from "@lingui/core/macro"
import { getPagePath } from "@nanostores/router"
import { $router } from "@/components/router"
import { $userSettings } from "@/lib/stores"

/** Pages that can open at start, instead of all the systems */
export const homePages = {
	home: () => t`All Systems`,
	monitors: () => t`Network Monitors`,
	containers: () => t`All Containers`,
	services: () => t`All Services`,
	reboots: () => t`All Reboots`,
} as const

export type HomePage = keyof typeof homePages

/** Path of the page chosen to open at start */
export function homePagePath() {
	const page = $userSettings.get().homePage as HomePage | undefined
	return getPagePath($router, page && page in homePages ? page : "home")
}

/**
 * Opens the page chosen to open at start when the app starts on the home page,
 * once the user settings are loaded. Links to all the systems still open them.
 */
export function openHomePage() {
	const page = $userSettings.get().homePage as HomePage | undefined
	if (!page || page === "home" || !(page in homePages) || $router.get()?.route !== "home") {
		return
	}
	$router.open(getPagePath($router, page), true)
}
