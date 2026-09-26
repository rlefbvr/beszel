import { t } from "@lingui/core/macro"
import { map, onMount } from "nanostores"
import { pb } from "@/lib/api"
import type { SensorAlertRecord } from "@/types"

/** Alerts of the user on the sensors, by id; loaded while a page uses them */
export const $sensorAlerts = map<Record<string, SensorAlertRecord>>({})

onMount($sensorAlerts, () => {
	let unsubscribe: (() => void) | undefined
	let cancelled = false
	;(async () => {
		try {
			const records = await pb.collection<SensorAlertRecord>("sensor_alerts").getFullList({ requestKey: null })
			if (cancelled) {
				return
			}
			$sensorAlerts.set(Object.fromEntries(records.map((record) => [record.id, record])))
			unsubscribe = await pb.collection<SensorAlertRecord>("sensor_alerts").subscribe("*", ({ action, record }) => {
				if (action === "delete") {
					const { [record.id]: _, ...rest } = $sensorAlerts.get()
					$sensorAlerts.set(rest)
				} else {
					$sensorAlerts.setKey(record.id, record)
				}
			})
		} catch (e) {
			console.error("get sensor alerts", e)
		}
	})()
	return () => {
		cancelled = true
		unsubscribe?.()
	}
})

/** Alerts of a sensor, in the order of the alert kinds */
export function alertsOfSensor(alerts: Record<string, SensorAlertRecord>, sensorId: string) {
	return Object.values(alerts)
		.filter((alert) => alert.sensor === sensorId)
		.sort((a, b) => sensorAlertOrder.indexOf(a.name) - sensorAlertOrder.indexOf(b.name))
}

export const sensorAlertOrder: SensorAlertRecord["name"][] = ["down", "port", "quality", "loss", "latency", "cert"]

/** Name of a kind of sensor alert */
export function sensorAlertName(name: SensorAlertRecord["name"]) {
	switch (name) {
		case "down":
			return t`Down`
		case "port":
			return t`Port not responding`
		case "quality":
			return t`Packet quality`
		case "loss":
			return t`Packet loss`
		case "latency":
			return t`Response time`
		case "cert":
			return t`TLS certificate`
	}
}
