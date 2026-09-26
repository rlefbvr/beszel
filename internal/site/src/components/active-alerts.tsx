import { alertInfo, stateAlertHistoryInfo } from "@/lib/alerts"
import { $sensorAlerts, sensorAlertName } from "@/lib/sensor-alerts"
import { $sensorChecks, $sensors, checkName } from "@/lib/sensors"
import { $stateAlerts, triggeredTargets } from "@/lib/state-alerts"
import { $alerts, $allSystemsById, $userSettings } from "@/lib/stores"
import { queueUserSettings } from "@/lib/api"
import { cn } from "@/lib/utils"
import { CheckCheckIcon, CheckIcon, EyeIcon, EyeOffIcon, NetworkIcon, UndoIcon } from "lucide-react"
import { t } from "@lingui/core/macro"
import { Plural, Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { getPagePath } from "@nanostores/router"
import { type ReactNode, useMemo, useState } from "react"
import { $router, Link } from "./router"
import { Alert, AlertTitle, AlertDescription } from "./ui/alert"
import { Button } from "./ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip"

/** An active alert of the panel: its card and the key of its current episode */
interface ActiveItem {
	/** changes when the alert triggers again, so an acknowledgement covers one episode only */
	key: string
	card: (acknowledged: boolean, onToggle: () => void) => ReactNode
}

/** Episode of an alert record: its id and the time of its last change */
const episodeKey = (record: { id: string; updated?: string }) => `${record.id}@${record.updated ?? ""}`

/** Keeps the acknowledgements of the active alerts only, and saves them */
function saveAcknowledged(keys: string[]) {
	$userSettings.setKey("ackAlerts", keys)
	queueUserSettings({ ackAlerts: keys })
}

export const ActiveAlerts = () => {
	const alerts = useStore($alerts)
	const stateAlerts = useStore($stateAlerts)
	const systems = useStore($allSystemsById)
	const sensorAlerts = useStore($sensorAlerts)
	const sensors = useStore($sensors)
	const sensorChecks = useStore($sensorChecks)
	const acknowledged = useStore($userSettings).ackAlerts
	const [showAcknowledged, setShowAcknowledged] = useState(false)

	const items = useMemo(() => {
		const items: ActiveItem[] = []

		for (const systemId of Object.keys(alerts)) {
			for (const alert of alerts[systemId].values()) {
				if (!alert.triggered || !(alert.name in alertInfo)) {
					continue
				}
				const info = alertInfo[alert.name as keyof typeof alertInfo]
				items.push({
					key: episodeKey(alert),
					card: (ack, onToggle) => (
						<AlertCard
							key={alert.id}
							icon={<info.icon className="h-4 w-4" />}
							title={
								<>
									{systems[alert.system]?.name} {info.name()}
								</>
							}
							href={getPagePath($router, "system", { id: alert.system })}
							acknowledged={ack}
							onToggle={onToggle}
						>
							{info.triggeredDesc ? (
								info.triggeredDesc()
							) : alert.name === "NetworkMonitorLoss" ? (
								<Trans>One or more monitors exceed {alert.value}% loss</Trans>
							) : alert.name === "Status" ? (
								<Trans>Connection is down</Trans>
							) : info.invert ? (
								<Trans>
									Below {alert.value}
									{info.unit} in last <Plural value={alert.min} one="# minute" other="# minutes" />
								</Trans>
							) : (
								<Trans>
									Exceeds {alert.value}
									{info.unit} in last <Plural value={alert.min} one="# minute" other="# minutes" />
								</Trans>
							)}
						</AlertCard>
					),
				})
			}
		}

		// service / container state rules with open incidents
		for (const rule of Object.values(stateAlerts)) {
			if (!rule.triggered) {
				continue
			}
			const targets = triggeredTargets(rule)
			const info = stateAlertHistoryInfo[rule.kind === "service" ? "ServiceState" : "ContainerState"]
			const Icon = info.icon
			items.push({
				// the rule is saved on each check: its episode is the open incident of each target
				key: `${rule.id}:${targets.map((name) => rule.state?.t?.[name]?.h).join()}`,
				card: (ack, onToggle) => (
					<AlertCard
						key={rule.id}
						icon={<Icon className="h-4 w-4" />}
						title={
							<>
								{systems[rule.system]?.name} {info.name()}
							</>
						}
						href={getPagePath($router, "system", { id: rule.system })}
						acknowledged={ack}
						onToggle={onToggle}
					>
						{targets.length > 0 ? targets.join(", ") : info.triggeredDesc?.()}
					</AlertCard>
				),
			})
		}

		// alerts of the network sensors
		for (const alert of Object.values(sensorAlerts)) {
			if (!alert.triggered) {
				continue
			}
			const sensor = sensors[alert.sensor]
			const ports = (alert.checks ?? [])
				.map((id) => sensorChecks[id])
				.filter((check) => check && check.status === "down")
				.map((check) => checkName(check))
			items.push({
				key: episodeKey(alert),
				card: (ack, onToggle) => (
					<AlertCard
						key={alert.id}
						icon={<NetworkIcon className="h-4 w-4" />}
						title={
							<>
								{sensor?.name} {sensorAlertName(alert.name)}
							</>
						}
						href={getPagePath($router, "sensor", { id: alert.sensor })}
						acknowledged={ack}
						onToggle={onToggle}
					>
						{alert.name === "port" && ports.length ? ports.join(", ") : sensor?.host}
					</AlertCard>
				),
			})
		}
		return items
	}, [alerts, stateAlerts, sensorAlerts, sensors, sensorChecks, systems])

	if (!items.length) {
		return null
	}

	// acknowledgements of the alerts still active; the others are dropped on the next change
	const activeKeys = new Set(items.map((item) => item.key))
	const ackKeys = new Set((acknowledged ?? []).filter((key) => activeKeys.has(key)))
	const toggle = (key: string) => {
		const next = new Set(ackKeys)
		if (next.has(key)) next.delete(key)
		else next.add(key)
		saveAcknowledged([...next])
	}
	const pending = items.filter((item) => !ackKeys.has(item.key))
	const ackCount = items.length - pending.length
	const shown = showAcknowledged ? items : pending

	// all acknowledged and hidden: a discreet line
	if (!shown.length) {
		return (
			<Card className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
				<CheckCheckIcon className="size-4" />
				<Plural value={ackCount} one="# active alert acknowledged" other="# active alerts acknowledged" />
				<Button variant="ghost" size="sm" className="h-7 gap-1.5 ms-auto" onClick={() => setShowAcknowledged(true)}>
					<EyeIcon className="size-4" />
					<Trans>Show</Trans>
				</Button>
			</Card>
		)
	}

	return (
		<Card className="border-red-500/60 bg-red-500/5 dark:bg-red-500/10">
			<CardHeader className="pt-4 pb-4 px-2 sm:px-6 max-sm:pt-3 max-sm:pb-1">
				<div className="px-2 sm:px-1 flex flex-wrap items-center gap-2">
					<CardTitle className="text-red-600 dark:text-red-400 me-auto">
						<Trans>Active Alerts</Trans>
					</CardTitle>
					{ackCount > 0 && (
						<Button
							variant="ghost"
							size="sm"
							className="h-8 gap-1.5 text-muted-foreground"
							onClick={() => setShowAcknowledged((value) => !value)}
						>
							{showAcknowledged ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
							{showAcknowledged ? (
								<Trans>Hide acknowledged</Trans>
							) : (
								<Plural value={ackCount} one="Show # acknowledged" other="Show # acknowledged" />
							)}
						</Button>
					)}
					{pending.length > 0 && (
						<Button
							variant="outline"
							size="sm"
							className="h-8 gap-1.5"
							onClick={() => saveAcknowledged([...ackKeys, ...pending.map((item) => item.key)])}
						>
							<CheckCheckIcon className="size-4" />
							<Trans>Acknowledge all</Trans>
						</Button>
					)}
				</div>
			</CardHeader>
			<CardContent className="max-sm:p-2">
				<div className="grid sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
					{shown.map((item) => item.card(ackKeys.has(item.key), () => toggle(item.key)))}
				</div>
			</CardContent>
		</Card>
	)
}

/** Card of an active alert, linking to its system or sensor, with its acknowledge button */
function AlertCard({
	icon,
	title,
	href,
	acknowledged,
	onToggle,
	children,
}: {
	icon: ReactNode
	title: ReactNode
	href: string
	acknowledged: boolean
	onToggle: () => void
	children: ReactNode
}) {
	const label = acknowledged ? t`Cancel the acknowledgement` : t`Acknowledge`
	// the button stays outside the Alert, whose styles indent the elements after its icon
	return (
		<div className={cn("relative duration-200 hover:-translate-y-px", acknowledged && "opacity-60")}>
			<Alert
				className={cn(
					"h-full bg-background border-red-500/30 hover:shadow-md shadow-black/5 pe-12",
					acknowledged && "border-border"
				)}
			>
				{icon}
				<AlertTitle>{title}</AlertTitle>
				<AlertDescription className="truncate">{children}</AlertDescription>
				<Link href={href} className="absolute inset-0 w-full h-full" aria-label={t`View`}></Link>
			</Alert>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						className="absolute top-1/2 -translate-y-1/2 end-2 z-10 size-8 text-muted-foreground hover:text-foreground"
						aria-label={label}
						onClick={onToggle}
					>
						{acknowledged ? <UndoIcon className="size-4" /> : <CheckIcon className="size-4" />}
					</Button>
				</TooltipTrigger>
				<TooltipContent>{label}</TooltipContent>
			</Tooltip>
		</div>
	)
}
