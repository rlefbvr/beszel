import { t } from "@lingui/core/macro"
import { Plural, Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { BellIcon } from "lucide-react"
import { memo, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { alertInfo } from "@/lib/alerts"
import { $stateAlerts, systemStateAlerts } from "@/lib/state-alerts"
import { $alerts } from "@/lib/stores"
import { cn } from "@/lib/utils"
import type { AlertRecord, SystemRecord } from "@/types"
import { AlertDialogContent } from "./alerts-sheet"

/** Opens the alerts of a system. outline is the bordered style of the system page toolbar. */
export default memo(function AlertsButton({ system, outline = false }: { system: SystemRecord; outline?: boolean }) {
	const [opened, setOpened] = useState(false)
	const alerts = useStore($alerts)
	const stateAlerts = useStore($stateAlerts)

	const systemAlerts = alerts[system.id]
	const rulesCount = systemStateAlerts(stateAlerts, system.id).length
	const hasSystemAlert = systemAlerts?.size > 0 || rulesCount > 0
	return useMemo(
		() => (
			<Sheet>
				<Tooltip>
					<TooltipTrigger asChild>
						<SheetTrigger asChild>
							<Button
								variant={outline ? "outline" : "ghost"}
								size="icon"
								aria-label={t`Alerts`}
								data-nolink
								onClick={() => setOpened(true)}
							>
								<BellIcon
									className={cn(outline ? "size-4" : "size-[1.2em]", "pointer-events-none", {
										"fill-primary": hasSystemAlert,
									})}
								/>
							</Button>
						</SheetTrigger>
					</TooltipTrigger>
					<TooltipContent side={outline ? "bottom" : "left"} className="max-w-72">
						<AlertsSummary alerts={systemAlerts} rulesCount={rulesCount} />
					</TooltipContent>
				</Tooltip>
				<SheetContent className="max-h-full overflow-auto w-160 !max-w-full p-4 sm:p-6">
					{opened && <AlertDialogContent system={system} />}
				</SheetContent>
			</Sheet>
		),
		[opened, hasSystemAlert, outline, systemAlerts, rulesCount]
	)
})

/** Alerts configured on a system: threshold and duration of each, and the number of state rules */
function AlertsSummary({ alerts, rulesCount }: { alerts?: Map<string, AlertRecord>; rulesCount: number }) {
	if (!alerts?.size && !rulesCount) {
		return <Trans>No alerts configured</Trans>
	}
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
