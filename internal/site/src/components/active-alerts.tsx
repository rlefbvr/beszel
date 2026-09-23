import { alertInfo, stateAlertHistoryInfo } from "@/lib/alerts"
import { $stateAlerts, triggeredTargets } from "@/lib/state-alerts"
import { $alerts, $allSystemsById } from "@/lib/stores"
import type { AlertRecord, StateAlertRecord } from "@/types"
import { Plural, Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { getPagePath } from "@nanostores/router"
import { useMemo } from "react"
import { $router, Link } from "./router"
import { Alert, AlertTitle, AlertDescription } from "./ui/alert"
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card"

export const ActiveAlerts = () => {
	const alerts = useStore($alerts)
	const stateAlerts = useStore($stateAlerts)
	const systems = useStore($allSystemsById)

	const { activeAlerts, activeRules, alertsKey } = useMemo(() => {
		const activeAlerts: AlertRecord[] = []
		// key to prevent re-rendering if alerts change but active alerts didn't
		const alertsKey: string[] = []

		for (const systemId of Object.keys(alerts)) {
			for (const alert of alerts[systemId].values()) {
				if (alert.triggered && alert.name in alertInfo) {
					activeAlerts.push(alert)
					alertsKey.push(`${alert.id}${alert.value}${alert.min}`)
				}
			}
		}

		// service / container state rules with open incidents
		const activeRules: { rule: StateAlertRecord; targets: string[] }[] = []
		for (const rule of Object.values(stateAlerts)) {
			if (rule.triggered) {
				const targets = triggeredTargets(rule)
				activeRules.push({ rule, targets })
				alertsKey.push(`${rule.id}${targets.join()}`)
			}
		}

		return { activeAlerts, activeRules, alertsKey }
	}, [alerts, stateAlerts])

	// biome-ignore lint/correctness/useExhaustiveDependencies: alertsKey is inclusive
	return useMemo(() => {
		if (activeAlerts.length === 0 && activeRules.length === 0) {
			return null
		}
		return (
			<Card>
				<CardHeader className="pb-4 px-2 sm:px-6 max-sm:pt-5 max-sm:pb-1">
					<div className="px-2 sm:px-1">
						<CardTitle>
							<Trans>Active Alerts</Trans>
						</CardTitle>
					</div>
				</CardHeader>
				<CardContent className="max-sm:p-2">
					{(activeAlerts.length > 0 || activeRules.length > 0) && (
						<div className="grid sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
							{activeAlerts.map((alert) => {
								const info = alertInfo[alert.name as keyof typeof alertInfo]
								return (
									<Alert
										key={alert.id}
										className="hover:-translate-y-px duration-200 bg-transparent border-foreground/10 hover:shadow-md shadow-black/5"
									>
										<info.icon className="h-4 w-4" />
										<AlertTitle>
											{systems[alert.system]?.name} {info.name()}
										</AlertTitle>
										<AlertDescription>
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
										</AlertDescription>
										<Link
											href={getPagePath($router, "system", { id: systems[alert.system]?.id })}
											className="absolute inset-0 w-full h-full"
											aria-label="View system"
										></Link>
									</Alert>
								)
							})}
							{activeRules.map(({ rule, targets }) => {
								const info = stateAlertHistoryInfo[rule.kind === "service" ? "ServiceState" : "ContainerState"]
								const Icon = info.icon
								return (
									<Alert
										key={rule.id}
										className="hover:-translate-y-px duration-200 bg-transparent border-foreground/10 hover:shadow-md shadow-black/5"
									>
										<Icon className="h-4 w-4" />
										<AlertTitle>
											{systems[rule.system]?.name} {info.name()}
										</AlertTitle>
										<AlertDescription className="truncate">
											{targets.length > 0 ? targets.join(", ") : info.triggeredDesc?.()}
										</AlertDescription>
										<Link
											href={getPagePath($router, "system", { id: rule.system })}
											className="absolute inset-0 w-full h-full"
											aria-label="View system"
										></Link>
									</Alert>
								)
							})}
						</div>
					)}
				</CardContent>
			</Card>
		)
	}, [alertsKey.join("")])
}
