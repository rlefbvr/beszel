import { atom } from "nanostores"
import { pb } from "@/lib/api"
import { $systems } from "@/lib/stores"

/** A program running on the systems that are up, and the systems running it */
export interface FleetProgramName {
	name: string
	systems: string[]
}

/** How long the palette keeps the programs read from the agents */
const keepFor = 60_000

let cache: { at: number; key: string; programs: Promise<FleetProgramName[]> } | undefined

/**
 * The programs of the systems that are up, read from their agents by the hub:
 * kept a minute, so that the command palette asks the agents once per search.
 */
export function fleetProgramNames(): Promise<FleetProgramName[]> {
	const ids = $systems
		.get()
		.filter((system) => system.status === "up")
		.map((system) => system.id)
		.sort()
	const key = ids.join()
	if (!ids.length) {
		return Promise.resolve([])
	}
	if (cache && cache.key === key && Date.now() - cache.at < keepFor) {
		return cache.programs
	}
	const programs = pb
		.send<{ systems: { system: string; programs?: { name: string }[] }[] }>("/api/beszel/processes/overview", {
			query: { systems: key, programs: 1 },
			requestKey: null,
		})
		.then((res) => {
			const byName = new Map<string, string[]>()
			for (const overview of res.systems) {
				for (const program of overview.programs ?? []) {
					byName.set(program.name, [...(byName.get(program.name) ?? []), overview.system])
				}
			}
			return [...byName].map(([name, systems]) => ({ name, systems }))
		})
	// a failed reading is asked again by the next search
	programs.catch(() => {
		cache = undefined
	})
	cache = { at: Date.now(), key, programs }
	return programs
}

/** A program to look for on the page of the processes, chosen in the command palette */
export const $processSearch = atom<string | null>(null)
