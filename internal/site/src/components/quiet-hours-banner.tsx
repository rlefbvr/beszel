import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { getPagePath } from "@nanostores/router"
import { ClockIcon, MoonIcon, Settings2Icon } from "lucide-react"
import { atom } from "nanostores"
import { lazy, Suspense } from "react"
import { $router, Link } from "@/components/router"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { $quietHours, activeQuietHours, quietHoursEnd, quietHoursReasonLabel, useNow } from "@/lib/quiet-hours"
import { $allSystemsById } from "@/lib/stores"
import { cn } from "@/lib/utils"
import type { QuietHoursRecord } from "@/types"

/** Windows listed before collapsing the rest into a count */
const maxListed = 3

const QuietHours = lazy(() =>
	import("@/components/routes/settings/quiet-hours").then((module) => ({ default: module.QuietHours }))
)

/** System whose quiet hours dialog is open, "" when closed */
const $quietHoursDialog = atom("")

/** "14:30" today, or a short date and time on another day */
function formatEnd(end: Date, now: Date) {
	const sameDay = end.toDateString() === now.toDateString()
	return end.toLocaleString([], sameDay ? { hour: "numeric", minute: "2-digit" } : { dateStyle: "short", timeStyle: "short" })
}

/**
 * Shows the quiet hours windows active now, with a link to their settings.
 * With a systemId, only the windows that silence this system, and the button
 * opens the quiet hours dialog of the system.
 */
export function QuietHoursBanner({ systemId }: { systemId?: string }) {
	const records = useStore($quietHours)
	const systems = useStore($allSystemsById)
	const now = useNow()
	const active = activeQuietHours(records, systemId, now)
	if (!active.length) {
		return null
	}
	const more = active.length - maxListed

	const describe = (record: QuietHoursRecord) => {
		const until = formatEnd(quietHoursEnd(record, now), now)
		const reason = quietHoursReasonLabel(record.reason)
		const name = systems[record.system]?.name ?? record.system
		return (
			<li key={record.id}>
				{!record.system ? (
					<Trans>All systems until {until}</Trans>
				) : systemId ? (
					<Trans>This system until {until}</Trans>
				) : (
					<Trans>
						{name} until {until}
					</Trans>
				)}
				{reason && <span className="text-muted-foreground"> · {reason}</span>}
			</li>
		)
	}

	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-4 py-3 text-sm">
			<MoonIcon className="size-5 shrink-0 text-indigo-600 dark:text-indigo-400" />
			<div className="grid gap-0.5 min-w-0 flex-1">
				<p className="font-medium">
					<Trans>Quiet hours active: notifications are not sent</Trans>
				</p>
				<ul className="grid gap-0.5">
					{active.slice(0, maxListed).map(describe)}
					{more > 0 && (
						<li className="text-muted-foreground">
							<Trans>and {more} more</Trans>
						</li>
					)}
				</ul>
			</div>
			{systemId ? (
				<Button variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={() => $quietHoursDialog.set(systemId)}>
					<Settings2Icon className="size-4" />
					<Trans>Settings</Trans>
				</Button>
			) : (
				<Link
					href={getPagePath($router, "settings", { name: "notifications" })}
					className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0 gap-1.5")}
				>
					<Settings2Icon className="size-4" />
					<Trans>Settings</Trans>
				</Link>
			)}
		</div>
	)
}

/** Moon shown next to a system name while quiet hours silence it */
export function QuietHoursIndicator({ systemId }: { systemId: string }) {
	const records = useStore($quietHours)
	const now = useNow()
	const [first] = activeQuietHours(records, systemId, now)
	if (!first) {
		return null
	}
	const until = formatEnd(quietHoursEnd(first, now), now)
	const reason = quietHoursReasonLabel(first.reason)
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<MoonIcon className="size-3.5 shrink-0 text-indigo-600 dark:text-indigo-400 relative z-10" />
			</TooltipTrigger>
			<TooltipContent>
				<Trans>Quiet hours until {until}</Trans>
				{reason && <span className="text-muted-foreground"> · {reason}</span>}
			</TooltipContent>
		</Tooltip>
	)
}

/** Button of the system page toolbar opening the quiet hours of the system */
export function QuietHoursButton({ systemId }: { systemId: string }) {
	const open = useStore($quietHoursDialog) === systemId
	const records = useStore($quietHours)
	const now = useNow()
	const active = activeQuietHours(records, systemId, now).length > 0
	return (
		<Dialog open={open} onOpenChange={(value) => $quietHoursDialog.set(value ? systemId : "")}>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button variant="outline" size="icon" aria-label={t`Quiet Hours`} onClick={() => $quietHoursDialog.set(systemId)}>
						<ClockIcon className={cn("size-4", active && "text-indigo-600 dark:text-indigo-400")} />
					</Button>
				</TooltipTrigger>
				<TooltipContent>{active ? <Trans>Quiet hours active</Trans> : <Trans>Quiet Hours</Trans>}</TooltipContent>
			</Tooltip>
			{open && (
				<DialogContent className="max-w-4xl w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>
							<Trans>Quiet Hours</Trans>
						</DialogTitle>
						<DialogDescription>
							<Trans>
								Schedule quiet hours where notifications will not be sent, such as during maintenance periods.
							</Trans>
						</DialogDescription>
					</DialogHeader>
					<Suspense>
						<QuietHours systemId={systemId} compact />
					</Suspense>
				</DialogContent>
			)}
		</Dialog>
	)
}
