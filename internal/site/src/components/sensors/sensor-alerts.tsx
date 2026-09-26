import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import {
	BadgeAlertIcon,
	GaugeIcon,
	HourglassIcon,
	PercentIcon,
	PlugZapIcon,
	ServerOffIcon,
	ShieldAlertIcon,
	TimerIcon,
} from "lucide-react"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import { CheckBadge } from "@/components/sensors/sensor-badges"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/use-toast"
import { pb } from "@/lib/api"
import { sensorAlertName } from "@/lib/sensor-alerts"
import { $checksBySensor } from "@/lib/sensors"
import { debounce } from "@/lib/utils"
import type { SensorAlertRecord, SensorRecord } from "@/types"

type AlertName = SensorAlertRecord["name"]

interface AlertKind {
	name: AlertName
	icon: React.ElementType
	description: (value: number) => ReactNode
	/** threshold and its unit, none for the alerts without a threshold */
	value?: { default: number; min: number; max: number; unit: () => string }
	/** default minutes the condition must last, undefined when the alert has no duration */
	min?: number
}

const kinds: AlertKind[] = [
	{
		name: "down",
		icon: ServerOffIcon,
		description: () => <Trans>A check of the sensor does not respond.</Trans>,
		min: 0,
	},
	{
		name: "port",
		icon: PlugZapIcon,
		description: () => <Trans>One of the chosen ports does not respond.</Trans>,
		min: 0,
	},
	{
		name: "quality",
		icon: GaugeIcon,
		description: (value) =>
			value >= 2 ? (
				<Trans>The packet quality over 10 minutes is bad.</Trans>
			) : (
				<Trans>The packet quality over 10 minutes is degraded or bad.</Trans>
			),
		min: 5,
	},
	{
		name: "loss",
		icon: PercentIcon,
		description: (value) => <Trans>The packet loss over 10 minutes exceeds {value}%.</Trans>,
		value: { default: 5, min: 1, max: 100, unit: () => "%" },
		min: 5,
	},
	{
		name: "latency",
		icon: TimerIcon,
		description: (value) => <Trans>The average response time over 10 minutes exceeds {value} ms.</Trans>,
		value: { default: 200, min: 1, max: 60000, unit: () => "ms" },
		min: 5,
	},
	{
		name: "cert",
		icon: ShieldAlertIcon,
		description: (value) => <Trans>The certificate of an HTTPS check expires within {value} days.</Trans>,
		value: { default: 14, min: 1, max: 365, unit: () => t`days` },
	},
]

/** Alerts of the user on a sensor: down, ports, quality, packet loss, response time and certificate expiry */
export function SensorAlerts({ sensor }: { sensor: SensorRecord }) {
	const [records, setRecords] = useState<Record<string, SensorAlertRecord>>({})
	const checks = useStore($checksBySensor)[sensor.id] ?? []
	const userId = pb.authStore.record?.id ?? ""
	const sensorName = sensor.name

	useEffect(() => {
		pb.collection<SensorAlertRecord>("sensor_alerts")
			.getFullList({ filter: pb.filter("sensor={:sensor}", { sensor: sensor.id }) })
			.then((items) => setRecords(Object.fromEntries(items.map((item) => [item.name, item]))))
			.catch((e) => console.error("get sensor alerts", e))
	}, [sensor.id])

	const failed = (e: unknown) =>
		toast({ variant: "destructive", title: t`Failed to save settings`, description: (e as Error).message })

	const setEnabled = async (kind: AlertKind, enabled: boolean) => {
		try {
			const existing = records[kind.name]
			if (!enabled && existing) {
				await pb.collection("sensor_alerts").delete(existing.id)
				setRecords(({ [kind.name]: _, ...rest }) => rest)
			} else if (enabled && !existing) {
				const record = await pb.collection<SensorAlertRecord>("sensor_alerts").create({
					user: userId,
					sensor: sensor.id,
					name: kind.name,
					value: kind.value?.default ?? (kind.name === "quality" ? 2 : 0),
					min: kind.min ?? 0,
					// a port alert starts with the ports other than ping
					checks: kind.name === "port" ? checks.filter((check) => check.protocol !== "icmp").map((c) => c.id) : [],
				})
				setRecords((current) => ({ ...current, [kind.name]: record }))
			}
		} catch (e) {
			failed(e)
		}
	}

	const save = useMemo(
		() =>
			debounce(async (id: string, data: Partial<SensorAlertRecord>) => {
				try {
					await pb.collection("sensor_alerts").update(id, data)
				} catch (e) {
					failed(e)
				}
			}, 600),
		[]
	)

	const update = (kind: AlertKind, data: Partial<SensorAlertRecord>) => {
		const existing = records[kind.name]
		if (!existing) {
			return
		}
		setRecords((current) => ({ ...current, [kind.name]: { ...existing, ...data } }))
		save(existing.id, data)
	}

	return (
		<div className="grid gap-4">
			<SheetHeader className="p-0">
				<SheetTitle>
					<Trans>Alerts of {sensorName}</Trans>
				</SheetTitle>
				<SheetDescription>
					<Trans>Your alerts on this sensor. Quiet hours of the sensor and global ones silence them.</Trans>
				</SheetDescription>
			</SheetHeader>
			{kinds.map((kind) => {
				const record = records[kind.name]
				const Icon = kind.icon
				const value = record?.value ?? kind.value?.default ?? (kind.name === "quality" ? 2 : 0)
				const chosen = new Set(record?.checks ?? [])
				return (
					<div key={kind.name} className="rounded-lg border p-4 grid gap-3">
						<div className="flex items-start gap-3">
							<Icon className="size-5 mt-0.5 shrink-0 text-muted-foreground" />
							<div className="grid gap-0.5 flex-1">
								<span className="font-medium">{sensorAlertName(kind.name)}</span>
								<span className="text-sm text-muted-foreground">{kind.description(value)}</span>
							</div>
							<Switch
								checked={!!record}
								onCheckedChange={(checked) => setEnabled(kind, checked)}
								aria-label={sensorAlertName(kind.name)}
							/>
						</div>
						{record && (
							<div className="flex flex-wrap items-center gap-x-5 gap-y-2 ps-8 text-sm">
								{kind.name === "port" && (
									<div className="grid gap-1.5 w-full">
										{checks.map((check) => (
											<div key={check.id} className="flex items-center gap-2 w-fit">
												<Checkbox
													id={`port-alert-${check.id}`}
													checked={chosen.has(check.id)}
													onCheckedChange={(checked) => {
														const next = new Set(chosen)
														if (checked) next.add(check.id)
														else next.delete(check.id)
														update(kind, { checks: [...next] })
													}}
												/>
												<label htmlFor={`port-alert-${check.id}`} className="flex items-center gap-2 cursor-pointer">
													<CheckBadge check={check} />
													{check.port > 0 && (
														<span className="text-xs text-muted-foreground tabular-nums">{check.port}</span>
													)}
												</label>
											</div>
										))}
										{!chosen.size && (
											<span className="text-xs text-destructive">
												<Trans>Choose at least one port.</Trans>
											</span>
										)}
									</div>
								)}
								{kind.name === "quality" && (
									<div className="flex items-center gap-2">
										<BadgeAlertIcon className="size-4 text-muted-foreground" />
										<label htmlFor="quality-value">
											<Trans>Threshold</Trans>
										</label>
										<Select value={String(value)} onValueChange={(v) => update(kind, { value: Number(v) })}>
											<SelectTrigger id="quality-value" className="h-8 w-auto min-w-44 gap-3 whitespace-nowrap">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="1">
													<Trans>Degraded or bad</Trans>
												</SelectItem>
												<SelectItem value="2">
													<Trans>Bad</Trans>
												</SelectItem>
											</SelectContent>
										</Select>
									</div>
								)}
								{kind.value && (
									<div className="flex items-center gap-2">
										<BadgeAlertIcon className="size-4 text-muted-foreground" />
										<label htmlFor={`${kind.name}-value`}>
											<Trans>Threshold</Trans>
										</label>
										<Input
											id={`${kind.name}-value`}
											type="number"
											min={kind.value.min}
											max={kind.value.max}
											value={record.value}
											onChange={(e) => update(kind, { value: Number(e.target.value) || 0 })}
											className="h-8 w-24 tabular-nums"
										/>
										{kind.value.unit()}
									</div>
								)}
								{kind.min !== undefined && (
									<div className="flex items-center gap-2">
										<HourglassIcon className="size-4 text-muted-foreground" />
										<label htmlFor={`${kind.name}-min`}>
											<Trans>For</Trans>
										</label>
										<Input
											id={`${kind.name}-min`}
											type="number"
											min={0}
											max={1440}
											value={record.min}
											onChange={(e) => update(kind, { min: Math.max(0, Number(e.target.value) || 0) })}
											className="h-8 w-20 tabular-nums"
										/>
										<Trans>min</Trans>
									</div>
								)}
							</div>
						)}
					</div>
				)
			})}
		</div>
	)
}
