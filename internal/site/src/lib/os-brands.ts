import { useStore } from "@nanostores/react"
import { map, onMount } from "nanostores"
import { pb } from "@/lib/api"
import { Os } from "@/lib/enums"
import type { SystemDetailsRecord, SystemRecord } from "@/types"

/** OS of each system from its details: family and name, such as "Debian GNU/Linux 12 (bookworm)" */
export const $systemOs = map<Record<string, { os?: Os; name: string }>>({})

let loading: Promise<void> | undefined

/** Loads the OS of all the systems, once while the store is used */
function loadSystemOs() {
	loading ??= pb
		.collection<SystemDetailsRecord>("system_details")
		.getFullList({ fields: "system,os,os_name" })
		.then((records) => {
			$systemOs.set(Object.fromEntries(records.map((r) => [r.system, { os: r.os, name: r.os_name ?? "" }])))
		})
		.catch(() => {
			loading = undefined
		})
}

onMount($systemOs, () => {
	loadSystemOs()
})

/**
 * Brand of an OS, to filter the systems: Windows, Windows Server, macOS,
 * FreeBSD, or the Linux distribution without its version ("Debian", "Ubuntu").
 */
export function osBrand(os: Os | undefined, name = ""): string {
	switch (os) {
		case Os.Windows:
			return /server/i.test(name) ? "Windows Server" : "Windows"
		case Os.Darwin:
			return "macOS"
		case Os.FreeBSD:
			return "FreeBSD"
	}
	const words: string[] = []
	for (const word of name.replace(/GNU\/Linux|\bLinux\b|\brelease\b/gi, " ").split(/\s+/).filter(Boolean)) {
		// the version and code name end the brand: "Ubuntu 24.04.1 LTS", "Debian 12 (bookworm)"
		if (/^[\d(v]/.test(word)) {
			break
		}
		words.push(word)
	}
	return words.join(" ") || "Linux"
}

/** Brand of the OS of each system, the older agents giving the family only */
export function useSystemBrands(systems: SystemRecord[]) {
	const details = useStore($systemOs)
	const brands: Record<string, string> = {}
	for (const system of systems) {
		const detail = details[system.id]
		brands[system.id] = osBrand(detail?.os ?? system.info?.os, detail?.name)
	}
	return brands
}
