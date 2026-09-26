import { t } from "@lingui/core/macro"
import { computed, map, onMount } from "nanostores"
import { pb } from "@/lib/api"
import type { SensorCheckRecord, SensorProtocol, SensorRecord } from "@/types"

/** Network sensors checked by the hub, by id; loaded while a page uses them */
export const $sensors = map<Record<string, SensorRecord>>({})

/** Checks of the sensors, by id */
export const $sensorChecks = map<Record<string, SensorCheckRecord>>({})

/** Whether the sensors were loaded */
export const $sensorsLoaded = map({ loaded: false })

onMount($sensors, () => {
	let unsubscribe: (() => void)[] = []
	let cancelled = false
	;(async () => {
		try {
			const [sensors, checks] = await Promise.all([
				pb.collection<SensorRecord>("sensors").getFullList({ requestKey: null }),
				pb.collection<SensorCheckRecord>("sensor_checks").getFullList({ requestKey: null }),
			])
			if (cancelled) {
				return
			}
			$sensors.set(Object.fromEntries(sensors.map((sensor) => [sensor.id, sensor])))
			$sensorChecks.set(Object.fromEntries(checks.map((check) => [check.id, check])))
			$sensorsLoaded.setKey("loaded", true)
			unsubscribe = await Promise.all([
				pb.collection<SensorRecord>("sensors").subscribe("*", ({ action, record }) => {
					if (action === "delete") {
						const { [record.id]: _, ...rest } = $sensors.get()
						$sensors.set(rest)
					} else {
						$sensors.setKey(record.id, record)
					}
				}),
				pb.collection<SensorCheckRecord>("sensor_checks").subscribe("*", ({ action, record }) => {
					if (action === "delete") {
						const { [record.id]: _, ...rest } = $sensorChecks.get()
						$sensorChecks.set(rest)
					} else {
						$sensorChecks.setKey(record.id, record)
					}
				}),
			])
		} catch (e) {
			console.error("get sensors", e)
		}
	})()
	return () => {
		cancelled = true
		for (const fn of unsubscribe) {
			fn()
		}
		$sensorsLoaded.setKey("loaded", false)
	}
})

/** Checks of each sensor, in the order of their ports */
export const $checksBySensor = computed($sensorChecks, (checks) => {
	const bySensor: Record<string, SensorCheckRecord[]> = {}
	for (const check of Object.values(checks)) {
		bySensor[check.sensor] ??= []
		bySensor[check.sensor].push(check)
	}
	for (const list of Object.values(bySensor)) {
		list.sort((a, b) => protocolOrder[a.protocol] - protocolOrder[b.protocol] || a.port - b.port)
	}
	return bySensor
})

const protocolOrder: Record<SensorProtocol, number> = { icmp: 0, tcp: 1, http: 2, dns: 3, ntp: 4 }

/** Names of the groups of the sensors, sorted */
export const $sensorGroups = computed($sensors, (sensors) =>
	[
		...new Set(
			Object.values(sensors)
				.map((sensor) => sensor.group?.trim())
				.filter(Boolean)
		),
	].sort((a, b) => a.localeCompare(b))
)

/** A known port or service offered when adding a check, with the color of its pill */
export interface PortPreset {
	key: string
	protocol: SensorProtocol
	port: number
	label: string
	/** color of the pill and of the charts; the services of a family share a hue */
	color: string
}

/**
 * Known ports and services; UDP only for the services that answer (DNS, NTP).
 * Colors by family, lighter or darker within a family: web in greens (darker
 * with TLS), remote shells in purples, remote desktops in fuchsias, file
 * transfers in oranges, mail in skies and indigos, directory in pinks and
 * databases in teals.
 */
export const portPresets: PortPreset[] = [
	{ key: "icmp", protocol: "icmp", port: 0, label: "Ping", color: "#3b82f6" },
	{ key: "http", protocol: "http", port: 80, label: "HTTP", color: "#22c55e" },
	{ key: "https", protocol: "http", port: 443, label: "HTTPS", color: "#15803d" },
	{ key: "ssh", protocol: "tcp", port: 22, label: "SSH", color: "#a855f7" },
	{ key: "rdp", protocol: "tcp", port: 3389, label: "RDP", color: "#d946ef" },
	{ key: "dns", protocol: "dns", port: 53, label: "DNS", color: "#f59e0b" },
	{ key: "ntp", protocol: "ntp", port: 123, label: "NTP", color: "#06b6d4" },
	{ key: "smb", protocol: "tcp", port: 445, label: "SMB", color: "#f97316" },
	{ key: "ftp", protocol: "tcp", port: 21, label: "FTP", color: "#fdba74" },
	{ key: "ftps", protocol: "tcp", port: 990, label: "FTPS", color: "#c2410c" },
	{ key: "telnet", protocol: "tcp", port: 23, label: "Telnet", color: "#d8b4fe" },
	{ key: "smtp", protocol: "tcp", port: 25, label: "SMTP", color: "#38bdf8" },
	{ key: "smtps", protocol: "tcp", port: 465, label: "SMTPS", color: "#0369a1" },
	{ key: "submission", protocol: "tcp", port: 587, label: "SMTP submission", color: "#0ea5e9" },
	{ key: "imap", protocol: "tcp", port: 143, label: "IMAP", color: "#818cf8" },
	{ key: "imaps", protocol: "tcp", port: 993, label: "IMAPS", color: "#4338ca" },
	{ key: "pop3", protocol: "tcp", port: 110, label: "POP3", color: "#a5b4fc" },
	{ key: "pop3s", protocol: "tcp", port: 995, label: "POP3S", color: "#3730a3" },
	{ key: "ldap", protocol: "tcp", port: 389, label: "LDAP", color: "#f472b6" },
	{ key: "ldaps", protocol: "tcp", port: 636, label: "LDAPS", color: "#be185d" },
	{ key: "kerberos", protocol: "tcp", port: 88, label: "Kerberos", color: "#ec4899" },
	{ key: "mssql", protocol: "tcp", port: 1433, label: "SQL Server", color: "#0f766e" },
	{ key: "mysql", protocol: "tcp", port: 3306, label: "MySQL", color: "#14b8a6" },
	{ key: "postgres", protocol: "tcp", port: 5432, label: "PostgreSQL", color: "#0d9488" },
	{ key: "redis", protocol: "tcp", port: 6379, label: "Redis", color: "#2dd4bf" },
	{ key: "mongodb", protocol: "tcp", port: 27017, label: "MongoDB", color: "#5eead4" },
	{ key: "vnc", protocol: "tcp", port: 5900, label: "VNC", color: "#f0abfc" },
	{ key: "winrm", protocol: "tcp", port: 5985, label: "WinRM", color: "#7e22ce" },
	{ key: "proxmox", protocol: "http", port: 8006, label: "Proxmox", color: "#059669" },
	{ key: "http-alt", protocol: "http", port: 8080, label: "HTTP 8080", color: "#4ade80" },
	{ key: "https-alt", protocol: "http", port: 8443, label: "HTTPS 8443", color: "#166534" },
]

/** Colors offered for the pill of another port */
export const pillPalette = [
	"#3b82f6", "#0ea5e9", "#06b6d4", "#14b8a6", "#22c55e", "#84cc16", "#eab308", "#f59e0b",
	"#f97316", "#f43f5e", "#ec4899", "#d946ef", "#a855f7", "#8b5cf6", "#6366f1", "#71717a",
]

/** Color of the checks of another port without chosen color */
const defaultPillColor = "#a1a1aa"

/** Color of a protocol without known port */
const protocolDefaultColors: Record<SensorProtocol, string> = {
	icmp: "#3b82f6",
	tcp: defaultPillColor,
	http: "#22c55e",
	dns: "#f59e0b",
	ntp: "#06b6d4",
}

/** Known service of a check, from its protocol and port */
export function presetOf(check: Pick<SensorCheckRecord, "protocol" | "port">) {
	return portPresets.find(
		(preset) => preset.protocol === check.protocol && (check.protocol === "icmp" || preset.port === check.port)
	)
}

/** Color of the pill and of the charts of a check: of its known service, chosen, or of its protocol */
export function checkColor(check: Pick<SensorCheckRecord, "protocol" | "port"> & { color?: string }) {
	return presetOf(check)?.color || check.color || protocolDefaultColors[check.protocol] || defaultPillColor
}

/** Classes of a pill colored by the --pill variable: tinted background, readable text in both themes */
export const pillClass =
	"bg-[color-mix(in_oklab,var(--pill)_18%,transparent)] text-[color-mix(in_oklab,var(--pill)_72%,black)] dark:text-[color-mix(in_oklab,var(--pill)_62%,white)]"

/** Style giving the color of a pill */
export const pillStyle = (color: string) => ({ "--pill": color }) as React.CSSProperties

/** Name of a protocol, as shown in the badges */
export const protocolLabels: Record<SensorProtocol, () => string> = {
	icmp: () => "ICMP",
	tcp: () => "TCP",
	http: () => "HTTP",
	dns: () => "DNS",
	ntp: () => "NTP",
}

/** Transport of a protocol, as shown in the check list */
export const protocolTransport: Record<SensorProtocol, string> = {
	icmp: "ICMP",
	tcp: "TCP",
	http: "TCP",
	dns: "UDP",
	ntp: "UDP",
}



/** HTTP ports checked in HTTPS by the hub when the check has no address */
const httpsPorts = [443, 8443, 8006]

/** Protocol of a check as shown in its pill: ICMP, TCP, HTTP, HTTPS, DNS or NTP */
export function checkProtocol(check: Pick<SensorCheckRecord, "protocol" | "port"> & { url?: string }) {
	if (check.protocol === "http") {
		const https = check.url ? /^https:/i.test(check.url) : httpsPorts.includes(check.port)
		return https ? "HTTPS" : "HTTP"
	}
	return protocolLabels[check.protocol]()
}

/** Type of a check in its pill: the protocol, with the port when it has no label */
export function checkType(check: Pick<SensorCheckRecord, "label" | "protocol" | "port"> & { url?: string }) {
	const protocol = checkProtocol(check)
	return !check.label && check.port ? `${protocol} ${check.port}` : protocol
}

/** Name of a check: its label, or its protocol and port */
export function checkName(check: Pick<SensorCheckRecord, "label" | "protocol" | "port">) {
	if (check.label) {
		return check.label
	}
	return check.port ? `${protocolLabels[check.protocol]()} ${check.port}` : protocolLabels[check.protocol]()
}

/** Overall color of a sensor: red when down or bad, orange when degraded, green when up, grey otherwise */
export type SensorColor = "green" | "orange" | "red" | "grey"

export function sensorColor(sensor: Pick<SensorRecord, "status" | "quality">): SensorColor {
	if (sensor.status === "down" || (sensor.status === "up" && sensor.quality === "bad")) {
		return "red"
	}
	if (sensor.status === "up") {
		return sensor.quality === "degraded" ? "orange" : "green"
	}
	return "grey"
}

export const sensorColorClasses: Record<SensorColor, string> = {
	green: "bg-green-500",
	orange: "bg-orange-500",
	red: "bg-red-500",
	grey: "bg-zinc-400",
}

/** Label of a sensor status */
export function sensorStatusLabel(status: SensorRecord["status"]) {
	switch (status) {
		case "up":
			return t({ message: "Up", comment: "Context: System is up" })
		case "down":
			return t({ message: "Down", comment: "Context: System is down" })
		case "paused":
			return t`Paused`
		default:
			return t`Pending`
	}
}

/** Label of a packet quality */
export function qualityLabel(quality: SensorRecord["quality"]) {
	switch (quality) {
		case "good":
			return t({ message: "Good", context: "Packet quality" })
		case "degraded":
			return t({ message: "Degraded", context: "Packet quality" })
		case "bad":
			return t({ message: "Bad", context: "Packet quality" })
		default:
			return t`Unknown`
	}
}

/** A check being edited in the sensor dialog */
export interface CheckDraft {
	id?: string
	protocol: SensorProtocol
	/** color chosen for the pill of another port, "" for the default */
	color?: string
	port: number
	label: string
	url: string
	keyword: string
	accepted_codes: string
	ignore_tls: boolean
}

/** Saves a sensor and its checks: creates, updates and deletes the checks as needed */
export async function saveSensor(
	sensor: Partial<SensorRecord> & { id?: string },
	checks: CheckDraft[],
	existing: SensorCheckRecord[]
) {
	const collection = pb.collection<SensorRecord>("sensors")
	const { id, ...data } = sensor
	const saved = id ? await collection.update(id, data) : await collection.create(data)
	const batch = pb.createBatch()
	let operations = 0
	for (const check of checks) {
		const { id: checkId, ...fields } = check
		if (checkId) {
			batch.collection("sensor_checks").update(checkId, fields)
		} else {
			batch.collection("sensor_checks").create({ ...fields, sensor: saved.id })
		}
		operations++
	}
	const kept = new Set(checks.map((check) => check.id).filter(Boolean))
	for (const check of existing) {
		if (!kept.has(check.id)) {
			batch.collection("sensor_checks").delete(check.id)
			operations++
		}
	}
	if (operations) {
		await batch.send()
	}
	return saved
}

/** Sensor already checking a host, compared without case */
export function sensorOfHost(host: string) {
	const key = host.trim().toLowerCase()
	return Object.values($sensors.get()).find((sensor) => sensor.host.trim().toLowerCase() === key)
}

/** Same check: same protocol and port */
const sameCheck = (a: Pick<CheckDraft, "protocol" | "port">, b: Pick<CheckDraft, "protocol" | "port">) =>
	a.protocol === b.protocol && (a.protocol === "icmp" || a.port === b.port)

/**
 * Adds checks to the sensor of a host: the checks of the same host are grouped
 * in one sensor, so a host already checked gets the new checks (the ones it
 * doesn't have yet), and another host gets a new sensor.
 */
export async function addSensorChecks(sensor: Partial<SensorRecord>, checks: CheckDraft[]) {
	const existing = sensorOfHost(sensor.host ?? "")
	if (!existing) {
		const saved = await saveSensor(sensor, checks, [])
		return { sensor: saved, merged: false, added: checks.length }
	}
	const current = $checksBySensor.get()[existing.id] ?? []
	const added: CheckDraft[] = []
	for (const check of checks) {
		if (!current.some((c) => sameCheck(c, check)) && !added.some((c) => sameCheck(c, check))) {
			added.push(check)
		}
	}
	for (let i = 0; i < added.length; i += 50) {
		const batch = pb.createBatch()
		for (const { id: _, ...fields } of added.slice(i, i + 50)) {
			batch.collection("sensor_checks").create({ ...fields, sensor: existing.id })
		}
		await batch.send()
	}
	// the group of a bulk line applies to a sensor without group
	if (sensor.group && !existing.group) {
		await pb.collection("sensors").update(existing.id, { group: sensor.group })
	}
	return { sensor: existing, merged: true, added: added.length }
}

/** Set the group of sensors ("" removes them from their group), in batches of the hub limit */
export async function saveSensorGroups(changes: { id: string; group: string }[]) {
	for (let i = 0; i < changes.length; i += 50) {
		const batch = pb.createBatch()
		for (const { id, group } of changes.slice(i, i + 50)) {
			batch.collection("sensors").update(id, { group })
		}
		await batch.send()
	}
}
