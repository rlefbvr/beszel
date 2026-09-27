import { i18n } from "@lingui/core"
import { t } from "@lingui/core/macro"
import { map } from "nanostores"
import { alertInfo, stateAlertHistoryInfo } from "@/lib/alerts"
import { pb } from "@/lib/api"
import { stateRuleAlertKind } from "@/lib/state-alerts"
import type { QuietHoursRecord, StateAlertRecord } from "@/types"

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

/** Day of the last day of the month in the days of a monthly window */
export const lastDayOfMonth = 32
/** Week of the last week of the month in the weeks of a monthly window */
export const lastWeekOfMonth = 5

/** Weekday from Monday (1) to Sunday (7) */
function isoWeekday(date: Date) {
	return date.getDay() || 7
}

/** Whether a recurring window runs on a day, like the hub */
function dayMatches(record: QuietHoursRecord, day: Date) {
	const days = record.days ?? []
	const weeks = record.weeks ?? []
	switch (record.type) {
		case "weekly":
			return days.includes(isoWeekday(day))
		case "monthly": {
			const date = day.getDate()
			const daysInMonth = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate()
			if (!weeks.length) {
				return days.includes(date) || (days.includes(lastDayOfMonth) && date === daysInMonth)
			}
			if (!days.includes(isoWeekday(day))) {
				return false
			}
			const week = Math.floor((date - 1) / 7) + 1
			return weeks.includes(week) || (weeks.includes(lastWeekOfMonth) && date + 7 > daysInMonth)
		}
	}
	return true
}

/** Whether a window is active now, in the past (one-time windows) or inactive */
export function quietHoursState(record: QuietHoursRecord, now = new Date()): QuietHoursState {
	if (record.type !== "one-time") {
		const current = now.getHours() * 60 + now.getMinutes()
		const start = localMinutes(new Date(record.start))
		const end = localMinutes(new Date(record.end))
		// windows may span midnight: the occurrence then started the day before
		let day: Date | undefined
		if (start < end) {
			day = current >= start && current < end ? now : undefined
		} else if (start > end) {
			day = current >= start ? now : current < end ? new Date(now.getTime() - 86400_000) : undefined
		}
		return day && dayMatches(record, day) ? "active" : "inactive"
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
	if (record.type === "one-time") {
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

/** Short name of a weekday, from Monday (1) to Sunday (7) */
export function weekdayName(day: number, width: "narrow" | "short" | "long" = "short") {
	// 1 January 2024 is a Monday
	return new Intl.DateTimeFormat(i18n.locale, { weekday: width }).format(new Date(2024, 0, day))
}

/** Names of the weeks of a monthly window: 1st to 4th, and the last one */
export function weekOfMonthName(week: number) {
	switch (week) {
		case 1:
			return t`1st`
		case 2:
			return t`2nd`
		case 3:
			return t`3rd`
		case 4:
			return t`4th`
	}
	return t`last`
}

/** Hours of a recurring window in local time, such as "22:00 – 06:00" */
function windowHours(record: QuietHoursRecord) {
	const format = (value: string) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
	return `${format(record.start)} – ${format(record.end)}`
}

/**
 * When a window runs, such as "Mon, Wed · 22:00 – 06:00", "Day 1, last day of
 * the month · 08:00 – 10:00" or "2nd, last Tue of the month · …"
 */
export function quietHoursScheduleText(record: QuietHoursRecord, formatDate: (value: string) => string) {
	const hours = windowHours(record)
	const days = [...(record.days ?? [])].sort((a, b) => a - b)
	const weeks = [...(record.weeks ?? [])].sort((a, b) => a - b)
	switch (record.type) {
		case "one-time":
			return `${formatDate(record.start)} – ${formatDate(record.end)}`
		case "daily":
			return `${t`Every day`} · ${hours}`
		case "weekly": {
			const list = days.map((day) => weekdayName(day)).join(", ")
			return `${list} · ${hours}`
		}
		case "monthly": {
			if (weeks.length) {
				const weekList = weeks.map(weekOfMonthName).join(", ")
				const dayList = days.map((day) => weekdayName(day)).join(", ")
				return `${t`${weekList} ${dayList} of the month`} · ${hours}`
			}
			const dayList = days.map((day) => (day === lastDayOfMonth ? t`last day` : String(day))).join(", ")
			return `${t`Day ${dayList} of the month`} · ${hours}`
		}
	}
	return hours
}

/** Name of the type of a window */
export function quietHoursTypeLabel(type: QuietHoursRecord["type"]) {
	switch (type) {
		case "daily":
			return t`Daily`
		case "weekly":
			return t`Weekly`
		case "monthly":
			return t`Monthly`
	}
	return t`One-time`
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

/** Alert types a window can be limited to, in the order of the alerts sheet */
export const quietHoursAlertKinds = [
	"Status",
	"CPU",
	"CPUIOWait",
	"CPUSteal",
	"Memory",
	"Disk",
	"Bandwidth",
	"NetworkMonitorLoss",
	"GPU",
	"Temperature",
	"LoadAvg1",
	"LoadAvg5",
	"LoadAvg15",
	"Battery",
	"ContainerHealth",
	"SystemdFailed",
	"ServiceState",
	"ContainerState",
	"ProcessState",
	"Certificate",
	"Smart",
	"ZFS",
] as const

/** Alert types of the network sensors a window can be limited to */
export const quietHoursSensorKinds = [
	"SensorDown",
	"SensorPort",
	"SensorQuality",
	"SensorLoss",
	"SensorLatency",
	"SensorCert",
] as const

/** Name of an alert type of a window */
export function quietHoursAlertKindLabel(kind: string) {
	switch (kind) {
		case "Smart":
			return "S.M.A.R.T."
		case "ZFS":
			return "ZFS"
		case "Certificate":
			return t`Certificate expiry`
	}
	return (alertInfo[kind] ?? stateAlertHistoryInfo[kind])?.name() ?? kind
}

/** Whether a window silences only some alerts */
export function quietHoursScoped(record: Pick<QuietHoursRecord, "alerts" | "rules" | "targets">) {
	return !!record.alerts?.length || !!record.rules?.length || !!record.targets?.length
}

/**
 * Alerts silenced by a window limited to some of them, such as "CPU, Service
 * state: nginx"; empty for all. With ruleNames, a named rule shows its name.
 */
export function quietHoursScopeText(
	record: Pick<QuietHoursRecord, "alerts" | "rules" | "targets">,
	stateAlerts: Record<string, StateAlertRecord>,
	ruleNames = false
) {
	if (!quietHoursScoped(record)) {
		return ""
	}
	const rules = (record.rules ?? [])
		.map((id) => stateAlerts[id])
		.filter(Boolean)
		.map((rule) =>
			ruleNames && rule.name?.trim()
				? rule.name.trim()
				: `${quietHoursAlertKindLabel(stateRuleAlertKind(rule.kind))}: ${rule.targets}`
		)
	// the services, containers and processes chosen on their pages
	const targets = (["service", "container", "process"] as const)
		.map((kind) => {
			const names = (record.targets ?? []).filter((target) => target.kind === kind).map((target) => target.name)
			const label = quietHoursAlertKindLabel(stateRuleAlertKind(kind))
			return names.length ? `${label}: ${names.join(", ")}` : ""
		})
		.filter(Boolean)
	return [...(record.alerts ?? []).map(quietHoursAlertKindLabel), ...rules, ...targets].join(", ")
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
