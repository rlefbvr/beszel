import { map } from "nanostores"
import { pb } from "@/lib/api"
import type { StateAlertRecord } from "@/types"

const collection = "state_alerts"

/** The user's service / container state rules, by id */
export const $stateAlerts = map<Record<string, StateAlertRecord>>({})

let unsubscribeFn: (() => void) | undefined

/** Load all state rules of the user */
export async function refreshStateAlerts() {
	try {
		const records = await pb.collection<StateAlertRecord>(collection).getFullList({ sort: "created" })
		$stateAlerts.set(Object.fromEntries(records.map((record) => [record.id, record])))
	} catch (e) {
		console.error("get state alerts", e)
	}
}

/** Keep state rules in sync, including the triggered flags set by the hub */
export async function subscribeStateAlerts() {
	unsubscribeFn = await pb.collection<StateAlertRecord>(collection).subscribe("*", ({ action, record }) => {
		if (action === "delete") {
			const { [record.id]: _, ...rest } = $stateAlerts.get()
			$stateAlerts.set(rest)
		} else {
			$stateAlerts.setKey(record.id, record)
		}
	})
}

export function unsubscribeStateAlerts() {
	unsubscribeFn?.()
	unsubscribeFn = undefined
	$stateAlerts.set({})
}

/** Rules of one system, oldest first */
export function systemStateAlerts(rules: Record<string, StateAlertRecord>, systemId: string) {
	return Object.values(rules)
		.filter((rule) => rule.system === systemId)
		.sort((a, b) => a.created.localeCompare(b.created))
}

/** Names of the services / containers currently triggering a rule */
export function triggeredTargets(rule: StateAlertRecord): string[] {
	const targets = rule.state?.t ?? {}
	return Object.keys(targets)
		.filter((name) => targets[name]?.h)
		.sort()
}
