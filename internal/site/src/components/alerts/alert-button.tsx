import { t } from "@lingui/core/macro"
import { BellIcon } from "lucide-react"
import { memo, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useHostSensor } from "@/components/sensors/host-links"
import { cn } from "@/lib/utils"
import type { SystemRecord } from "@/types"
import { AlertDialogContent } from "./alerts-sheet"
import { AlertsTooltip, useAlertCounts } from "./alerts-tooltip"

/** Opens the alerts of a system. outline is the bordered style of the system page toolbar. */
export default memo(function AlertsButton({ system, outline = false }: { system: SystemRecord; outline?: boolean }) {
	const [opened, setOpened] = useState(false)
	// the alerts of the sensor sharing its address count too
	const sensor = useHostSensor(system.host)
	const counts = useAlertCounts(system, sensor)
	const hasSystemAlert = counts.system > 0 || counts.sensor > 0
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
						<AlertsTooltip system={system} sensor={sensor} first="system" />
					</TooltipContent>
				</Tooltip>
				<SheetContent className="max-h-full overflow-auto w-160 !max-w-full p-4 sm:p-6">
					{opened && <AlertDialogContent system={system} />}
				</SheetContent>
			</Sheet>
		),
		[opened, hasSystemAlert, outline, system, sensor]
	)
})
