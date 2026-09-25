import { i18n } from "@lingui/core"
import { useStore } from "@nanostores/react"
import { atom, onMount } from "nanostores"

/** Current time, shared by all components and updated while used */
const $now = atom(new Date())
onMount($now, () => {
	$now.set(new Date())
	const id = setInterval(() => $now.set(new Date()), 30_000)
	return () => clearInterval(id)
})

/** Current time, updated every 30 seconds to re-evaluate time based states */
export function useNow() {
	return useStore($now)
}

const relativeUnits: [Intl.RelativeTimeFormatUnit, number][] = [
	["year", 365 * 86400],
	["month", 30 * 86400],
	["week", 7 * 86400],
	["day", 86400],
	["hour", 3600],
	["minute", 60],
]

/** Time relative to now in the current language, such as "3 hours ago" */
export function formatRelativeTime(date: Date, now = new Date()) {
	const seconds = Math.round((date.getTime() - now.getTime()) / 1000)
	const format = new Intl.RelativeTimeFormat(i18n.locale, { numeric: "auto" })
	for (const [unit, size] of relativeUnits) {
		if (Math.abs(seconds) >= size) {
			return format.format(Math.round(seconds / size), unit)
		}
	}
	return format.format(0, "minute")
}
