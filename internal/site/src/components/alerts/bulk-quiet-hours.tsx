import { t } from "@lingui/core/macro"
import { Plural, Trans } from "@lingui/react/macro"
import { CalendarIcon, LoaderCircleIcon } from "lucide-react"
import { useState } from "react"
import { GuardedDialog } from "@/components/discard-guard"
import { Button } from "@/components/ui/button"
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { toast } from "@/components/ui/use-toast"
import { isReadOnlyUser, pb } from "@/lib/api"
import { quietHoursReasons } from "@/lib/quiet-hours"
import type { StateAlertRecord } from "@/types"

type Kind = StateAlertRecord["kind"]

/** Value of the reason select for a custom reason */
const customReason = "other"

/** Date and time of an input: YYYY-MM-DDTHH:mm in local time */
function localInput(date: Date) {
	const pad = (n: number) => String(n).padStart(2, "0")
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * "Quiet hours" button of the services and containers pages: silences the
 * state alerts of the selected items, with one window per system.
 */
export function BulkQuietHoursButton({ kind, items }: { kind: Kind; items: { name: string; system: string }[] }) {
	const [open, setOpen] = useState(false)
	if (isReadOnlyUser()) {
		return null
	}
	return (
		<GuardedDialog open={open} onOpenChange={setOpen}>
			<Tooltip>
				<TooltipTrigger asChild>
					<span className="inline-flex shrink-0">
						<Button variant="outline" className="gap-1.5" disabled={!items.length} onClick={() => setOpen(true)}>
							<CalendarIcon className="size-4" />
							<Trans>Quiet Hours</Trans>
							{items.length > 0 && <span className="text-muted-foreground tabular-nums">({items.length})</span>}
						</Button>
					</span>
				</TooltipTrigger>
				<TooltipContent>
					<Trans>Set up quiet hours for the selection below</Trans>
				</TooltipContent>
			</Tooltip>
			{open && <BulkQuietHoursDialog kind={kind} items={items} onClose={() => setOpen(false)} />}
		</GuardedDialog>
	)
}

function BulkQuietHoursDialog({
	kind,
	items,
	onClose,
}: {
	kind: Kind
	items: { name: string; system: string }[]
	onClose: () => void
}) {
	const now = new Date()
	const inAnHour = new Date(now.getTime() + 3600_000)
	const [type, setType] = useState<"one-time" | "daily">("one-time")
	const [start, setStart] = useState(localInput(now))
	const [end, setEnd] = useState(localInput(inAnHour))
	const [startTime, setStartTime] = useState("22:00")
	const [endTime, setEndTime] = useState("06:00")
	const [reasonChoice, setReasonChoice] = useState("")
	const [customText, setCustomText] = useState("")
	const [saving, setSaving] = useState(false)
	const count = items.length

	async function save(e: React.FormEvent) {
		e.preventDefault()
		setSaving(true)
		try {
			let startValue: string
			let endValue: string
			if (type === "daily") {
				// today's date so the current offset from UTC applies
				const today = new Date().toISOString().split("T")[0]
				startValue = new Date(`${today}T${startTime}:00`).toISOString()
				endValue = new Date(`${today}T${endTime}:00`).toISOString()
			} else {
				startValue = new Date(start).toISOString()
				endValue = new Date(end).toISOString()
			}
			const bySystem = new Map<string, string[]>()
			for (const item of items) {
				bySystem.set(item.system, [...(bySystem.get(item.system) ?? []), item.name])
			}
			for (const [system, names] of bySystem) {
				await pb.collection("quiet_hours").create({
					user: pb.authStore.record?.id,
					system,
					type,
					start: startValue,
					end: endValue,
					reason: reasonChoice === customReason ? customText.trim() : reasonChoice,
					targets: names.map((name) => ({ kind, name })),
				})
			}
			toast({ title: t`Quiet hours set up` })
			onClose()
		} catch (err) {
			toast({ variant: "destructive", title: t`Error`, description: (err as Error).message })
		} finally {
			setSaving(false)
		}
	}

	return (
		<DialogContent className="max-w-md">
			<DialogHeader>
				<DialogTitle>
					<Trans>Set up quiet hours</Trans>
				</DialogTitle>
				<DialogDescription>
					{kind === "service" ? (
						<Plural
							value={count}
							one="The state alerts of the selected service are not sent during this window."
							other="The state alerts of the # selected services are not sent during this window."
						/>
					) : (
						<Plural
							value={count}
							one="The state alerts of the selected container are not sent during this window."
							other="The state alerts of the # selected containers are not sent during this window."
						/>
					)}
				</DialogDescription>
			</DialogHeader>
			<form onSubmit={save} className="grid gap-4">
				<div className="grid gap-2">
					<Label htmlFor="bulk-quiet-type">
						<Trans>Type</Trans>
					</Label>
					<Select value={type} onValueChange={(value) => setType(value as typeof type)}>
						<SelectTrigger id="bulk-quiet-type">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="one-time">
								<Trans>One-time</Trans>
							</SelectItem>
							<SelectItem value="daily">
								<Trans>Daily</Trans>
							</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<div className="grid grid-cols-2 gap-2">
					<div className="grid gap-2">
						<Label htmlFor="bulk-quiet-start">
							<Trans>Start Time</Trans>
						</Label>
						{type === "daily" ? (
							<Input
								id="bulk-quiet-start"
								type="time"
								value={startTime}
								onChange={(e) => setStartTime(e.target.value)}
								required
							/>
						) : (
							<Input
								id="bulk-quiet-start"
								type="datetime-local"
								value={start}
								onChange={(e) => setStart(e.target.value)}
								required
								className="tabular-nums tracking-tighter"
							/>
						)}
					</div>
					<div className="grid gap-2">
						<Label htmlFor="bulk-quiet-end">
							<Trans>End Time</Trans>
						</Label>
						{type === "daily" ? (
							<Input
								id="bulk-quiet-end"
								type="time"
								value={endTime}
								onChange={(e) => setEndTime(e.target.value)}
								required
							/>
						) : (
							<Input
								id="bulk-quiet-end"
								type="datetime-local"
								value={end}
								min={start}
								onChange={(e) => setEnd(e.target.value)}
								required
								className="tabular-nums tracking-tighter"
							/>
						)}
					</div>
				</div>
				<div className="grid gap-2">
					<Label htmlFor="bulk-quiet-reason">
						<Trans>Reason</Trans>
					</Label>
					<Select
						value={reasonChoice || "none"}
						onValueChange={(value) => setReasonChoice(value === "none" ? "" : value)}
					>
						<SelectTrigger id="bulk-quiet-reason">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="none">
								<Trans>None</Trans>
							</SelectItem>
							{Object.entries(quietHoursReasons).map(([key, label]) => (
								<SelectItem key={key} value={key}>
									{label()}
								</SelectItem>
							))}
							<SelectItem value={customReason}>
								<Trans>Other</Trans>
							</SelectItem>
						</SelectContent>
					</Select>
					{reasonChoice === customReason && (
						<Input
							aria-label={t`Reason`}
							placeholder={t`Describe the reason`}
							value={customText}
							onChange={(e) => setCustomText(e.target.value)}
							maxLength={200}
							required
						/>
					)}
				</div>
				<DialogFooter>
					<Button type="submit" className="gap-2" disabled={saving}>
						{saving ? <LoaderCircleIcon className="size-4 animate-spin" /> : <CalendarIcon className="size-4" />}
						<Trans>Set up</Trans>
					</Button>
				</DialogFooter>
			</form>
		</DialogContent>
	)
}
