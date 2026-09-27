import { t } from "@lingui/core/macro"
import { Plural, Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { NetworkIcon, ServerIcon } from "lucide-react"
import { alertInfo } from "@/lib/alerts"
import { $sensorAlerts, alertsOfSensor, sensorAlertName } from "@/lib/sensor-alerts"
import { $checksBySensor, checkName } from "@/lib/sensors"
import { $stateAlerts, systemStateAlerts } from "@/lib/state-alerts"
import { $alerts } from "@/lib/stores"
import { cn } from "@/lib/utils"
import type { SensorRecord, SystemRecord } from "@/types"

/** Number of alerts of a system (alerts and state rules) and of a sensor, to fill their bell */
export function useAlertCounts(system?: SystemRecord, sensor?: SensorRecord) {
	const alerts = useStore($alerts)
	const rules = useStore($stateAlerts)
	const sensorAlerts = useStore($sensorAlerts)
	return {
		system: system ? (alerts[system.id]?.size ?? 0) + systemStateAlerts(rules, system.id).length : 0,
		sensor: sensor ? alertsOfSensor(sensorAlerts, sensor.id).length : 0,
	}
}

/** Alerts of a system: threshold and duration of each, and the number of state rules */
function SystemAlertsList({ system }: { system: SystemRecord }) {
	const alerts = useStore($alerts)[system.id]
	const rulesCount = systemStateAlerts(useStore($stateAlerts), system.id).length
	return (
		<ul className="grid gap-0.5">
			{[...(alerts?.values() ?? [])].map((alert) => {
				const info = alertInfo[alert.name]
				if (!info) {
					return null
				}
				const showThreshold = !info.singleDesc && !info.noThreshold
				const minutes = alert.min
				return (
					<li key={alert.name}>
						<span className="font-medium">{info.name()}</span>
						{showThreshold && (
							<span className="tabular-nums">
								{" "}
								{info.invert ? "<" : ">"} {alert.value}
								{info.unit}
							</span>
						)}
						{!info.noDuration && minutes > 0 && (
							<span className="text-muted-foreground tabular-nums">
								{" · "}
								<Plural value={minutes} one="# minute" other="# minutes" />
							</span>
						)}
					</li>
				)
			})}
			{rulesCount > 0 && (
				<li>
					<Plural value={rulesCount} one="# state rule" other="# state rules" />
				</li>
			)}
		</ul>
	)
}

/** Alerts of a sensor: kind, ports and threshold of each */
function SensorAlertsList({ sensor }: { sensor: SensorRecord }) {
	const alerts = alertsOfSensor(useStore($sensorAlerts), sensor.id)
	const checks = useStore($checksBySensor)[sensor.id] ?? []
	const portNames = (ids: string[] = []) =>
		checks
			.filter((check) => ids.includes(check.id))
			.map(checkName)
			.join(", ")
	return (
		<ul className="grid gap-0.5">
			{alerts.map((alert) => (
				<li key={alert.id}>
					<span className={cn("font-medium", alert.triggered && "text-red-500")}>{sensorAlertName(alert.name)}</span>
					{alert.name === "port" && alert.checks?.length ? (
						<span className="text-muted-foreground"> · {portNames(alert.checks)}</span>
					) : null}
					{(alert.name === "loss" || alert.name === "latency") && (
						<span className="tabular-nums">
							{" "}
							&gt; {alert.value}
							{alert.name === "loss" ? "%" : " ms"}
						</span>
					)}
					{alert.name === "cert" && (
						<span className="tabular-nums">
							{" "}
							&lt; {alert.value} {t`days`}
						</span>
					)}
				</li>
			))}
		</ul>
	)
}

/**
 * Tooltip of a bell: all the alerts of a system and of the sensor sharing its
 * address, the ones of the object of the bell first, the others under the
 * name of their host or sensor.
 */
export function AlertsTooltip({
	system,
	sensor,
	first,
}: {
	system?: SystemRecord
	sensor?: SensorRecord
	/** the object of the bell, listed first without its name */
	first: "system" | "sensor"
}) {
	const counts = useAlertCounts(system, sensor)
	if (!counts.system && !counts.sensor) {
		return <Trans>No alerts configured</Trans>
	}
	const systemPart = system && counts.system > 0 && (
		<div key="system" className="grid gap-0.5">
			{first === "sensor" && (
				<span className="flex items-center gap-1.5 text-muted-foreground">
					<ServerIcon className="size-3" />
					{system.name}
				</span>
			)}
			<SystemAlertsList system={system} />
		</div>
	)
	const sensorPart = sensor && counts.sensor > 0 && (
		<div key="sensor" className="grid gap-0.5">
			{first === "system" && (
				<span className="flex items-center gap-1.5 text-muted-foreground">
					<NetworkIcon className="size-3" />
					{sensor.name}
				</span>
			)}
			<SensorAlertsList sensor={sensor} />
		</div>
	)
	return <div className="grid gap-2">{first === "system" ? [systemPart, sensorPart] : [sensorPart, systemPart]}</div>
}
