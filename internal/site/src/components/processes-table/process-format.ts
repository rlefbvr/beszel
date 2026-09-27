import { decimalString, formatBytes } from "@/lib/utils"

/** A process of a host, as the agent reads it */
export interface ProcessRow {
	pid: number
	ppid?: number
	name: string
	user?: string
	status?: string
	command?: string
	cpu?: number
	mem?: number
	rss?: number
	dr?: number
	dw?: number
	threads?: number
	conns?: number
	started?: number
	/** system of the process, added by the page */
	system: string
}

/** Identifies a process across the readings: the PID with its start time, as PIDs are reused */
export const processKey = (process: Pick<ProcessRow, "pid" | "started">) => `p${process.pid}_${process.started ?? 0}`

export function formatRate(bytes?: number) {
	if (!bytes) {
		return "-"
	}
	const { value, unit } = formatBytes(bytes, true)
	return `${decimalString(value, value >= 10 ? 0 : 1)} ${unit}`
}

export function formatSize(bytes?: number) {
	if (!bytes) {
		return "-"
	}
	const { value, unit } = formatBytes(bytes)
	return `${decimalString(value, value >= 10 ? 0 : 1)} ${unit}`
}

export function percent(value?: number) {
	return value ? `${decimalString(value, value >= 10 ? 1 : 2)}%` : "-"
}

/** Share of the whole host from which a process is shown as heavy, then as very heavy */
const heavyUse = 25
const veryHeavyUse = 50

/** Colors a CPU or memory share of the host when a process uses much of it */
export function usageClass(value?: number) {
	if (!value || value < heavyUse) {
		return ""
	}
	return value >= veryHeavyUse
		? "text-red-600 dark:text-red-400 font-semibold"
		: "text-amber-600 dark:text-amber-400 font-medium"
}
