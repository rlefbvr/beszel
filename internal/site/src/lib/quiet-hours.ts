import { t } from "@lingui/core/macro"
import { map } from "nanostores"
import { pb } from "@/lib/api"
import type { QuietHoursRecord } from "@/types"

const collection = "quiet_hours"

/** The user's quiet hours windows, by id */
export const $quietHours = map<Record<string, QuietHoursRecord>>({})

let unsubscribeFn: (() => void) | undefined

/** Load all quiet hours windows of the user */
export async function refreshQuietHours() {
	try {
		const records = await pb.collection<QuietHoursRecord>(collection).getFullList({ sort: "system" })
		$quietHours.set(Object.fromEntries(records.map((record) => [record.id, record])))
	} catch (e) {
		console.error("get quiet hours", e)
	}
}

/** Keep quiet hours windows in sync */
export async function subscribeQuietHours() {
	unsubscribeFn = await pb.collection<QuietHoursRecord>(collection).subscribe("*", ({ action, record }) => {
		if (action === "delete") {
			const { [record.id]: _, ...rest } = $quietHours.get()
			$quietHours.set(rest)
		} else {
			$quietHours.setKey(record.id, record)
		}
	})
}

export function unsubscribeQuietHours() {
	unsubscribeFn?.()
	unsubscribeFn = undefined
	$quietHours.set({})
}

export type QuietHoursState = "active" | "past" | "inactive"

/** Minutes since local midnight of the time of day stored in a daily window date */
function localMinutes(date: Date) {
	// Convert UTC to local time using the stored date's offset, not the current date's offset.
	// This avoids a DST mismatch when records were saved in a different DST period.
	return (date.getUTCHours() * 60 + date.getUTCMinutes() - date.getTimezoneOffset() + 1440) % 1440
}

/** Whether a window is active now, in the past (one-time windows) or inactive */
export function quietHoursState(record: QuietHoursRecord, now = new Date()): QuietHoursState {
	if (record.type === "daily") {
		const current = now.getHours() * 60 + now.getMinutes()
		const start = localMinutes(new Date(record.start))
		const end = localMinutes(new Date(record.end))
		// windows may span midnight
		const active = start <= end ? current >= start && current < end : current >= start || current < end
		return active ? "active" : "inactive"
	}
	const start = new Date(record.start)
	const end = new Date(record.end)
	if (now >= start && now < end) {
		return "active"
	}
	return now >= end ? "past" : "inactive"
}

/** End of the current occurrence of an active window */
export function quietHoursEnd(record: QuietHoursRecord, now = new Date()): Date {
	if (record.type !== "daily") {
		return new Date(record.end)
	}
	const end = new Date(now)
	const endMinutes = localMinutes(new Date(record.end))
	end.setHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0)
	if (end <= now) {
		end.setDate(end.getDate() + 1)
	}
	return end
}

/** A system or a network sensor, whose quiet hours are the global windows and its own */
export interface QuietHoursTarget {
	system?: string
	sensor?: string
}

/** Whether a window applies to a target: global windows and the windows of the target; all without target */
export function quietHoursAppliesTo(record: QuietHoursRecord, target?: QuietHoursTarget) {
	if (!target?.system && !target?.sensor) {
		return true
	}
	if (!record.system && !record.sensor) {
		return true
	}
	return (!!target.system && record.system === target.system) || (!!target.sensor && record.sensor === target.sensor)
}

/**
 * Active windows, soonest ending first. With a system id or a target, only the
 * windows that apply to it (global or its own); otherwise all active windows.
 */
export function activeQuietHours(
	records: Record<string, QuietHoursRecord>,
	target?: string | QuietHoursTarget,
	now = new Date()
) {
	const applies = typeof target === "string" ? { system: target } : target
	return Object.values(records)
		.filter((record) => quietHoursAppliesTo(record, applies) && quietHoursState(record, now) === "active")
		.sort((a, b) => quietHoursEnd(a, now).getTime() - quietHoursEnd(b, now).getTime())
}

/** Preset reasons, stored by key and translated when displayed */
export const quietHoursReasons = {
	reboot: () => t`Host restart`,
	maintenance: () => t`Scheduled maintenance`,
	updates: () => t`System updates`,
	backup: () => t`Backup`,
	deployment: () => t`Deployment`,
	network: () => t`Network work`,
	power: () => t`Power outage`,
	migration: () => t`Migration`,
	testing: () => t`Testing`,
} as const

export type QuietHoursReason = keyof typeof quietHoursReasons

export function isPresetReason(reason?: string): reason is QuietHoursReason {
	return !!reason && Object.hasOwn(quietHoursReasons, reason)
}

/** Label of a stored reason: the translated preset or the custom text */
export function quietHoursReasonLabel(reason?: string) {
	return isPresetReason(reason) ? quietHoursReasons[reason]() : (reason ?? "")
}
