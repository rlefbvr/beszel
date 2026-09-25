import { computed } from "nanostores"
import { pb } from "@/lib/api"
import { $alerts, $systems } from "@/lib/stores"
import { $stateAlerts } from "@/lib/state-alerts"
import type { SystemRecord } from "@/types"

/** Key of the systems without group */
export const ungroupedKey = ""

/** Group of a system, ungroupedKey when none */
export function systemGroup(system: SystemRecord) {
	return system.group?.trim() ?? ungroupedKey
}

/** Names of the groups in use, sorted */
export const $systemGroups = computed($systems, (systems) =>
	[...new Set(systems.map(systemGroup).filter(Boolean))].sort((a, b) => a.localeCompare(b))
)

/** Home page filter on alerts: all systems, systems with any alert, with a state rule, or with an alert name */
export const alertFilterAny = "any"
export const alertFilterState = "state"

/** Whether a system has the alerts selected by an alert filter ("" matches all) */
export function matchesAlertFilter(system: SystemRecord, filter: string | undefined) {
	if (!filter) {
		return true
	}
	const alerts = $alerts.get()[system.id]
	const hasStateRule = Object.values($stateAlerts.get()).some((rule) => rule.system === system.id)
	if (filter === alertFilterAny) {
		return !!alerts?.size || hasStateRule
	}
	if (filter === alertFilterState) {
		return hasStateRule
	}
	return !!alerts?.has(filter)
}

/** Rows of systems split by group: named groups in order, then the ungrouped ones */
export function groupSystems<T>(items: T[], systemOf: (item: T) => SystemRecord) {
	const groups = new Map<string, T[]>()
	for (const item of items) {
		const group = systemGroup(systemOf(item))
		const members = groups.get(group)
		if (members) {
			members.push(item)
		} else {
			groups.set(group, [item])
		}
	}
	return [...groups.entries()].sort(
		([a], [b]) => Number(a === ungroupedKey) - Number(b === ungroupedKey) || a.localeCompare(b)
	)
}

/** Home page tabs: all systems, the systems of a group, or those without group */
export const allGroupsTab = "all"
export const ungroupedTab = "none"
export const groupTab = (group: string) => (group ? `group:${group}` : ungroupedTab)

/** Whether a system is shown in a home page tab */
export function inGroupTab(system: SystemRecord, tab: string) {
	return tab === allGroupsTab || groupTab(systemGroup(system)) === tab
}

/** Set the group of systems ("" removes them from their group), in batches of the hub limit */
export async function saveSystemGroups(changes: { id: string; group: string }[]) {
	const batchSize = 50
	for (let i = 0; i < changes.length; i += batchSize) {
		const batch = pb.createBatch()
		for (const { id, group } of changes.slice(i, i + batchSize)) {
			batch.collection("systems").update(id, { group })
		}
		await batch.send()
	}
}
