import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { useEffect, useState } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
	checkType,
	checkColor,
	pillClass,
	pillStyle,
	protocolTransport,
	qualityLabel,
	sensorColor,
	sensorColorClasses,
	sensorStatusLabel,
} from "@/lib/sensors"
import { pb } from "@/lib/api"
import { formatDateTime } from "@/lib/time"
import { cn, decimalString } from "@/lib/utils"
import type { SensorCheckRecord, SensorRecord } from "@/types"

/** Color of the pulse around the dots */
const pingClasses = { green: "bg-green-400", orange: "bg-orange-400", red: "bg-red-400", grey: "" }

/** Colored dot of the state of a sensor: green, orange (degraded), red (down or bad) or grey */
export function SensorDot({
	sensor,
	className,
}: {
	sensor: Pick<SensorRecord, "status" | "quality">
	className?: string
}) {
	const color = sensorColor(sensor)
	return (
		<span className={cn("relative flex size-2.5 shrink-0", className)}>
			{color !== "grey" && (
				<span
					className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-75", pingClasses[color])}
				/>
			)}
			<span className={cn("relative inline-flex size-full rounded-full", sensorColorClasses[color])} />
		</span>
	)
}

/** Badge of a check: its name colored by protocol, with its state on hover */
export function CheckBadge({ check, className }: { check: SensorCheckRecord; className?: string }) {
	const down = check.status === "down"
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span
					style={pillStyle(checkColor(check))}
					className={cn(
						"inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 text-[0.7rem] font-semibold leading-none tabular-nums",
						pillClass,
						down && "bg-red-500/15 text-red-600 dark:text-red-400 line-through decoration-1",
						className
					)}
				>
					<span className="uppercase">{checkType(check)}</span>
					{check.label && <span className="font-medium">- {check.label}</span>}
				</span>
			</TooltipTrigger>
			<TooltipContent className="max-w-80">
				<p className="font-medium">
					{protocolTransport[check.protocol]}
					{check.port ? ` ${check.port}` : ""} · {checkStatusLabel(check)}
				</p>
				{check.res > 0 && check.status === "up" && <p>{decimalString(check.res, check.res < 10 ? 2 : 0)} ms</p>}
				{check.message && <p className="text-muted-foreground break-words">{check.message}</p>}
			</TooltipContent>
		</Tooltip>
	)
}

/** Label of the state of a check */
export function checkStatusLabel(check: Pick<SensorCheckRecord, "status">) {
	return sensorStatusLabel(check.status || "pending")
}

/** Badge of the packet quality of a sensor, in the color of its state */
export function QualityBadge({ sensor }: { sensor: Pick<SensorRecord, "status" | "quality"> & { loss?: number } }) {
	const color = sensorColor(sensor)
	const classes = {
		green: "bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/30",
		orange: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30",
		red: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",
		grey: "bg-zinc-500/10 text-muted-foreground border-zinc-500/20",
	}[color]
	// every probe lost: the host does not answer at all
	const label =
		sensor.status === "up" || sensor.status === "down"
			? (sensor.loss ?? 0) >= 100
				? t`Unreachable`
				: qualityLabel(sensor.quality)
			: sensorStatusLabel(sensor.status)
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span
					className={cn(
						"inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
						classes
					)}
				>
					<SensorDot sensor={sensor} className="size-2" />
					{label}
				</span>
			</TooltipTrigger>
			<TooltipContent>
				<Trans>Exchange quality</Trans>
			</TooltipContent>
		</Tooltip>
	)
}

/** Color of a period of probes: green without failure, orange with some, red when all failed */
function heartbeatColor(total: number, success: number) {
	if (!total) {
		return "bg-muted"
	}
	if (success === total) {
		return "bg-green-500"
	}
	return success === 0 ? "bg-red-500" : "bg-orange-500"
}

/** Probes of a sensor in a period of the heartbeat bar */
export interface Beat {
	t: number
	total: number
	success: number
}

/** Window of the heartbeat bar in seconds: half an hour for the probes every 10 seconds, else an hour */
export function heartbeatWindow(interval: number) {
	return interval <= 10 ? 1800 : 3600
}

/** Probes of the heartbeat window by periods of the sensor interval, from the hub, refreshed at each period */
function useSensorHeartbeat(sensorId: string, interval: number) {
	const [beats, setBeats] = useState<Beat[]>([])
	useEffect(() => {
		let cancelled = false
		const load = async () => {
			try {
				const data = await pb.send<Beat[]>(`/api/beszel/sensors/${encodeURIComponent(sensorId)}/heartbeat`, {
					query: { period: interval, window: heartbeatWindow(interval) },
					requestKey: `sensor-heartbeat-${sensorId}`,
				})
				if (!cancelled) {
					setBeats(data)
				}
			} catch {
				// canceled by a newer request
			}
		}
		load()
		const timer = setInterval(load, Math.max(10, interval) * 1000)
		return () => {
			cancelled = true
			clearInterval(timer)
		}
	}, [sensorId, interval])
	return beats
}

/** One bar per interval of the sensor over the last hour, colored by the share of successful probes */
export function SensorHeartbeat({
	sensorId,
	interval,
	className,
}: {
	sensorId: string
	/** seconds between two probes of the sensor */
	interval: number
	className?: string
}) {
	const beats = useSensorHeartbeat(sensorId, interval)
	return <BeatBars beats={beats} className={cn("h-10", className)} />
}

/** Probes of the last periods of every sensor, by sensor id, from the hub, refreshed every 10 seconds */
export function useSensorsHeartbeats(bars: number) {
	const [beats, setBeats] = useState<Record<string, Beat[]>>({})
	useEffect(() => {
		let cancelled = false
		const load = async () => {
			try {
				const data = await pb.send<Record<string, Beat[]>>("/api/beszel/sensors/heartbeats", {
					query: { bars },
					requestKey: "sensors-heartbeats",
				})
				if (!cancelled) {
					setBeats(data)
				}
			} catch {
				// canceled by a newer request
			}
		}
		load()
		const timer = setInterval(load, 10_000)
		return () => {
			cancelled = true
			clearInterval(timer)
		}
	}, [bars])
	return beats
}

/** One bar per period, the latest on the right, colored by the share of successful probes */
export function BeatBars({ beats, className }: { beats: Beat[]; className?: string }) {
	return (
		<div className={cn("flex items-stretch gap-px", className)} role="img" aria-label={t`Recent checks`}>
			{beats.map(({ t: time, total, success }) =>
				total ? (
					<Tooltip key={time}>
						<TooltipTrigger asChild>
							<span className={cn("flex-1 min-w-px rounded-[2px]", heartbeatColor(total, success))} />
						</TooltipTrigger>
						<TooltipContent>
							<p className="tabular-nums">{formatDateTime(time)}</p>
							<p>
								<Trans>
									{success} of {total} successful
								</Trans>
							</p>
						</TooltipContent>
					</Tooltip>
				) : (
					<span key={time} className="flex-1 min-w-px rounded-[2px] bg-muted" />
				)
			)}
		</div>
	)
}
