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

/** Lowercase comma separated patterns of a rule */
export function rulePatterns(rule: StateAlertRecord): string[] {
	return rule.targets
		.split(",")
		.map((p) => p.trim().toLowerCase())
		.filter(Boolean)
}

/**
 * Names a pattern is matched against, like the hub: the full name, the systemd
 * unit without ".service", and the Windows short name in parentheses.
 */
function nameCandidates(name: string): string[] {
	const lower = name.toLowerCase()
	const candidates = [lower]
	if (lower.endsWith(".service")) {
		candidates.push(lower.slice(0, -".service".length))
	}
	const i = lower.lastIndexOf(" (")
	if (lower.endsWith(")") && i > 0) {
		candidates.push(lower.slice(i + 2, -1), lower.slice(0, i))
	}
	return candidates
}

const globCache = new Map<string, RegExp>()

/** Glob with * and ? wildcards, matching the whole name */
function globToRegExp(pattern: string): RegExp {
	let re = globCache.get(pattern)
	if (!re) {
		const source = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")
		re = new RegExp(`^${source}$`)
		globCache.set(pattern, re)
	}
	return re
}

export function isLiteralPattern(pattern: string) {
	return !/[*?[]/.test(pattern)
}

/** Whether a service / container name is targeted by a rule */
export function ruleMatchesName(rule: StateAlertRecord, name: string): boolean {
	const candidates = nameCandidates(name)
	return rulePatterns(rule).some((pattern) => {
		const re = globToRegExp(pattern)
		return candidates.some((candidate) => re.test(candidate))
	})
}

export interface ImportantTarget<T> {
	/** Reported service / container, undefined when a named target is missing */
	item?: T
	name: string
	system: string
	/** A rule for this target currently has an open incident */
	triggered: boolean
}

/**
 * Services or containers targeted by a state rule ("important"), plus literal
 * targets that are no longer reported.
 */
export function importantTargets<T extends { name: string; system: string }>(
	rules: Record<string, StateAlertRecord>,
	kind: StateAlertRecord["kind"],
	items: T[],
	systemId?: string
): ImportantTarget<T>[] {
	const byKey = new Map<string, ImportantTarget<T>>()
	for (const rule of Object.values(rules)) {
		if (rule.kind !== kind || (systemId && rule.system !== systemId)) {
			continue
		}
		const triggered = new Set(triggeredTargets(rule))
		const matched = new Set<string>()
		for (const item of items) {
			if (item.system !== rule.system || !ruleMatchesName(rule, item.name)) {
				continue
			}
			for (const candidate of nameCandidates(item.name)) matched.add(candidate)
			const key = `${item.system}/${item.name}`
			const existing = byKey.get(key)
			byKey.set(key, {
				item,
				name: item.name,
				system: item.system,
				triggered: (existing?.triggered ?? false) || triggered.has(item.name),
			})
		}
		// named targets the agent no longer reports (stopped containers, missing services)
		for (const pattern of rulePatterns(rule)) {
			if (!isLiteralPattern(pattern) || matched.has(pattern)) {
				continue
			}
			const key = `${rule.system}/${pattern}`
			const existing = byKey.get(key)
			byKey.set(key, {
				name: pattern,
				system: rule.system,
				triggered: (existing?.triggered ?? false) || triggered.has(pattern),
			})
		}
	}
	return [...byKey.values()].sort((a, b) => Number(b.triggered) - Number(a.triggered) || a.name.localeCompare(b.name))
}
