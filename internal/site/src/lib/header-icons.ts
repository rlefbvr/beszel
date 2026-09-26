import { t } from "@lingui/core/macro"
import { $userSettings } from "@/lib/stores"

/** Icons of the header that each user can hide; the settings and account menus always stay */
export const headerIcons = {
	search: () => t`Search`,
	sensors: () => t`Network sensors`,
	systems: () => t`All Systems`,
	processes: () => t`All processes`,
	containers: () => t`All Containers`,
	services: () => t`All Services`,
	reboots: () => t`All Reboots`,
	certificates: () => t`All certificates`,
	smart: () => "S.M.A.R.T.",
	theme: () => t`Switch theme`,
	add: () => t`Add`,
}

export type HeaderIcon = keyof typeof headerIcons

/** Whether an icon of the header is shown for the current user */
export function headerIconShown(icon: HeaderIcon) {
	return !($userSettings.get().hiddenHeaderIcons ?? []).includes(icon)
}
