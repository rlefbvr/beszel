import { pb } from "@/lib/api"
import { portPresets } from "@/lib/sensors"
import type { SensorCheckRecord, SensorRecord, SystemRecord } from "@/types"

/** A host of the systems without ping check, and the sensor of its address if any */
export interface MissingPing {
	/** address of the host, compared without case */
	host: string
	/** name of the first system of this address, the name of a new sensor */
	name: string
	/** group of that system, the group of a new sensor */
	group: string
	/** sensor of this address without ping check, which gets one */
	sensor?: Pick<SensorRecord, "id" | "name">
}

const hostKey = (host: string) => host.trim().toLowerCase()

/** Addresses a sensor can't ping: none, or the Unix socket of a local agent */
const pingable = (host: string) => !!host.trim() && !host.trim().startsWith("/")

/**
 * The hosts of the systems that no ping (ICMP) check follows yet: read from
 * the hub rather than from the stores, which may not be loaded after a login.
 */
export async function missingPings(): Promise<MissingPing[]> {
	const [systems, sensors, checks] = await Promise.all([
		pb
			.collection<SystemRecord>("systems")
			.getFullList({ fields: "id,name,host,group", sort: "name", requestKey: null }),
		pb.collection<SensorRecord>("sensors").getFullList({ fields: "id,name,host", requestKey: null }),
		pb
			.collection<SensorCheckRecord>("sensor_checks")
			.getFullList({ fields: "sensor", filter: "protocol = 'icmp'", requestKey: null }),
	])
	const pinged = new Set(checks.map((check) => check.sensor))
	const sensorsByHost = new Map(sensors.map((sensor) => [hostKey(sensor.host), sensor]))
	const missing = new Map<string, MissingPing>()
	for (const system of systems) {
		const key = hostKey(system.host)
		if (!pingable(system.host) || missing.has(key)) {
			continue
		}
		const sensor = sensorsByHost.get(key)
		if (sensor && pinged.has(sensor.id)) {
			continue
		}
		missing.set(key, {
			host: system.host.trim(),
			name: system.name,
			group: (system.group ?? "").trim().slice(0, 40),
			sensor: sensor && { id: sensor.id, name: sensor.name },
		})
	}
	return [...missing.values()]
}

const ping = portPresets.find((preset) => preset.key === "icmp")!
const pingCheck = {
	protocol: ping.protocol,
	port: ping.port,
	label: ping.label,
	url: "",
	keyword: "",
	accepted_codes: "",
	ignore_tls: false,
}

/**
 * Follows hosts with a ping check: a new sensor named after the system, or a
 * ping check added to the sensor of the address. Returns how many of each.
 */
export async function createPings(hosts: MissingPing[]) {
	let created = 0
	let added = 0
	for (const host of hosts) {
		if (host.sensor) {
			await pb.collection("sensor_checks").create({ ...pingCheck, sensor: host.sensor.id })
			added++
			continue
		}
		const sensor = await pb.collection<SensorRecord>("sensors").create({
			name: host.name.slice(0, 100),
			host: host.host,
			group: host.group,
			interval: 60,
			retries: 1,
		})
		await pb.collection("sensor_checks").create({ ...pingCheck, sensor: sensor.id })
		created++
	}
	return { created, added }
}
