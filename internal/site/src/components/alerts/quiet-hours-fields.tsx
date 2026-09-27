import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { MonthlyDays, WeekdayChips } from "@/components/quiet-hours-days"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { quietHoursReasons } from "@/lib/quiet-hours"
import type { QuietHoursRecord } from "@/types"

/** Value of the reason select for a custom reason */
const customReason = "other"

/** A quiet hours window being set up with a state rule */
export interface QuietHoursDraft {
	type: QuietHoursRecord["type"]
	/** date and time of a one-time window, YYYY-MM-DDTHH:mm in local time */
	start: string
	end: string
	/** hours of a recurring window, HH:mm in local time */
	startTime: string
	endTime: string
	days: number[]
	weeks: number[]
	monthlyByWeekday: boolean
	/** preset reason key, customReason, or "" for none */
	reason: string
	customReason: string
}

/** Date and time of an input: YYYY-MM-DDTHH:mm in local time */
function localInput(date: Date) {
	const pad = (n: number) => String(n).padStart(2, "0")
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** A new window: the next hour, or every night from 22:00 to 06:00 */
export function newQuietHoursDraft(): QuietHoursDraft {
	const now = new Date()
	return {
		type: "daily",
		start: localInput(now),
		end: localInput(new Date(now.getTime() + 3600_000)),
		startTime: "22:00",
		endTime: "06:00",
		days: [],
		weeks: [],
		monthlyByWeekday: false,
		reason: "",
		customReason: "",
	}
}

/** What is missing in a draft, or "" when it can be saved */
export function quietHoursDraftError(draft: QuietHoursDraft) {
	if ((draft.type === "weekly" || draft.type === "monthly") && !draft.days.length) {
		return t`Choose at least one day.`
	}
	if (draft.type === "monthly" && draft.monthlyByWeekday && !draft.weeks.length) {
		return t`Choose at least one week of the month.`
	}
	if (draft.type === "one-time" && (!draft.start || !draft.end || draft.end <= draft.start)) {
		return t`The end must come after the start.`
	}
	if (draft.reason === customReason && !draft.customReason.trim()) {
		return t`Describe the reason`
	}
	return ""
}

/** Fields of a quiet_hours record for a draft, without its user, system and scope */
export function quietHoursDraftData(draft: QuietHoursDraft) {
	let start: string
	let end: string
	if (draft.type === "one-time") {
		start = new Date(draft.start).toISOString()
		end = new Date(draft.end).toISOString()
	} else {
		// today's date so the current offset from UTC applies
		const today = new Date().toISOString().split("T")[0]
		start = new Date(`${today}T${draft.startTime}:00`).toISOString()
		end = new Date(`${today}T${draft.endTime}:00`).toISOString()
	}
	return {
		type: draft.type,
		start,
		end,
		timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		days: draft.type === "weekly" || draft.type === "monthly" ? [...draft.days].sort((a, b) => a - b) : [],
		weeks: draft.type === "monthly" && draft.monthlyByWeekday ? [...draft.weeks].sort((a, b) => a - b) : [],
		reason: draft.reason === customReason ? draft.customReason.trim() : draft.reason,
	}
}

/** Type, days, hours and reason of a quiet hours window */
export function QuietHoursFields({
	draft,
	onChange,
}: {
	draft: QuietHoursDraft
	onChange: (draft: QuietHoursDraft) => void
}) {
	const update = (patch: Partial<QuietHoursDraft>) => onChange({ ...draft, ...patch })
	const recurring = draft.type !== "one-time"
	return (
		<div className="grid gap-3">
			<div className="grid gap-1.5">
				<Label htmlFor="qh-type">
					<Trans>Type</Trans>
				</Label>
				<Select
					value={draft.type}
					onValueChange={(type: QuietHoursRecord["type"]) => update({ type, days: [], weeks: [] })}
				>
					<SelectTrigger id="qh-type">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="one-time">
							<Trans>One-time</Trans>
						</SelectItem>
						<SelectItem value="daily">
							<Trans>Daily</Trans>
						</SelectItem>
						<SelectItem value="weekly">
							<Trans>Weekly, on some days</Trans>
						</SelectItem>
						<SelectItem value="monthly">
							<Trans>Monthly</Trans>
						</SelectItem>
					</SelectContent>
				</Select>
			</div>
			{draft.type === "weekly" && <WeekdayChips selected={draft.days} onChange={(days) => update({ days })} />}
			{draft.type === "monthly" && (
				<MonthlyDays
					byWeekday={draft.monthlyByWeekday}
					days={draft.days}
					weeks={draft.weeks}
					onChange={(monthlyByWeekday, days, weeks) => update({ monthlyByWeekday, days, weeks })}
				/>
			)}
			<div className="grid grid-cols-2 gap-2">
				<div className="grid gap-1.5">
					<Label htmlFor="qh-start">
						<Trans>Start Time</Trans>
					</Label>
					<Input
						id="qh-start"
						type={recurring ? "time" : "datetime-local"}
						value={recurring ? draft.startTime : draft.start}
						onChange={(e) => update(recurring ? { startTime: e.target.value } : { start: e.target.value })}
						className="tabular-nums tracking-tighter"
					/>
				</div>
				<div className="grid gap-1.5">
					<Label htmlFor="qh-end">
						<Trans>End Time</Trans>
					</Label>
					<Input
						id="qh-end"
						type={recurring ? "time" : "datetime-local"}
						value={recurring ? draft.endTime : draft.end}
						min={recurring ? undefined : draft.start}
						onChange={(e) => update(recurring ? { endTime: e.target.value } : { end: e.target.value })}
						className="tabular-nums tracking-tighter"
					/>
				</div>
			</div>
			<div className="grid gap-1.5">
				<Label htmlFor="qh-reason">
					<Trans>Reason</Trans>
				</Label>
				<Select value={draft.reason || "none"} onValueChange={(value) => update({ reason: value === "none" ? "" : value })}>
					<SelectTrigger id="qh-reason">
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
				{draft.reason === customReason && (
					<Input
						aria-label={t`Reason`}
						placeholder={t`Describe the reason`}
						value={draft.customReason}
						onChange={(e) => update({ customReason: e.target.value })}
						maxLength={200}
					/>
				)}
			</div>
		</div>
	)
}
