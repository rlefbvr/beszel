import { map } from "nanostores"
import { pb } from "@/lib/api"
import type { AlertsHistoryRecord } from "@/types"

/** Most recent alert of a system */
export interface LastAlert {
	name: string
	created: string
}

/** Most recent alert of each system, from the alert history of the user */
export const $lastAlerts = map<Record<string, LastAlert>>({})

let unsubscribeFn: (() => void) | undefined

/** Keep the alert if it is the most recent of its system */
function remember(record: Pick<AlertsHistoryRecord, "system" | "name" | "created">) {
	const current = $lastAlerts.get()[record.system]
	if (!current || current.created < record.created) {
		$lastAlerts.setKey(record.system, { name: record.name, created: record.created })
	}
}

/** Load the most recent alert of each system */
export async function refreshLastAlerts() {
	try {
		const { items } = await pb.collection<AlertsHistoryRecord>("alerts_history").getList(1, 500, {
			sort: "-created",
			fields: "system,name,created",
		})
		$lastAlerts.set({})
		for (const record of items) {
			remember(record)
		}
	} catch (e) {
		console.error("get last alerts", e)
	}
}

export async function subscribeLastAlerts() {
	unsubscribeFn = await pb.collection<AlertsHistoryRecord>("alerts_history").subscribe("*", ({ action, record }) => {
		if (action === "create") {
			remember(record)
		}
	})
}

export function unsubscribeLastAlerts() {
	unsubscribeFn?.()
	unsubscribeFn = undefined
	$lastAlerts.set({})
}
