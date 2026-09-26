import { Trans } from "@lingui/react/macro"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { lastDayOfMonth, lastWeekOfMonth, weekdayName, weekOfMonthName } from "@/lib/quiet-hours"
import { cn } from "@/lib/utils"

/** Toggles a value in a list */
function toggled(list: number[], value: number) {
	return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

/** A day chip of the recurring windows */
function DayChip({
	active,
	onClick,
	label,
	title,
	className,
}: {
	active: boolean
	onClick: () => void
	label: React.ReactNode
	title?: string
	className?: string
}) {
	return (
		<Button
			type="button"
			variant={active ? "default" : "outline"}
			size="sm"
			aria-pressed={active}
			title={title}
			onClick={onClick}
			className={cn("h-7 px-0 text-xs tabular-nums", !active && "text-muted-foreground", className)}
		>
			{label}
		</Button>
	)
}

/** Days of the week of a weekly window, or of a monthly window on weekdays: M T W T F S S */
export function WeekdayChips({ selected, onChange }: { selected: number[]; onChange: (days: number[]) => void }) {
	const weekdays = [1, 2, 3, 4, 5, 6, 7]
	return (
		<div className="grid gap-2">
			<div className="flex items-center gap-2">
				<Label>
					<Trans>Days of the week</Trans>
				</Label>
				<div className="ms-auto flex gap-1 text-xs">
					<button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => onChange([1, 2, 3, 4, 5])}>
						<Trans>Weekdays</Trans>
					</button>
					<span className="text-muted-foreground">·</span>
					<button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => onChange([6, 7])}>
						<Trans>Weekend</Trans>
					</button>
				</div>
			</div>
			<div className="grid grid-cols-7 gap-1">
				{weekdays.map((day) => (
					<DayChip
						key={day}
						active={selected.includes(day)}
						onClick={() => onChange(toggled(selected, day))}
						label={weekdayName(day, "narrow")}
						title={weekdayName(day, "long")}
					/>
				))}
			</div>
		</div>
	)
}

/** Days of a monthly window: some days of the month, or some weekdays of some weeks */
export function MonthlyDays({
	byWeekday,
	days,
	weeks,
	onChange,
}: {
	byWeekday: boolean
	days: number[]
	weeks: number[]
	onChange: (byWeekday: boolean, days: number[], weeks: number[]) => void
}) {
	const dates = Array.from({ length: 31 }, (_, i) => i + 1)
	return (
		<div className="grid gap-3">
			<Tabs value={byWeekday ? "weekday" : "date"} onValueChange={(value) => onChange(value === "weekday", [], [])}>
				<TabsList className="grid w-full grid-cols-2">
					<TabsTrigger value="date">
						<Trans>Days of the month</Trans>
					</TabsTrigger>
					<TabsTrigger value="weekday">
						<Trans>Days of the week</Trans>
					</TabsTrigger>
				</TabsList>
			</Tabs>
			{byWeekday ? (
				<>
					<div className="grid gap-2">
						<Label>
							<Trans>Weeks of the month</Trans>
						</Label>
						<div className="grid grid-cols-5 gap-1.5">
							{[1, 2, 3, 4, lastWeekOfMonth].map((week) => (
								<DayChip
									key={week}
									active={weeks.includes(week)}
									onClick={() => onChange(true, days, toggled(weeks, week))}
									label={weekOfMonthName(week)}
								/>
							))}
						</div>
					</div>
					<WeekdayChips selected={days} onChange={(next) => onChange(true, next, weeks)} />
				</>
			) : (
				<div className="grid gap-2">
					<Label>
						<Trans>Days of the month</Trans>
					</Label>
					<div className="grid grid-cols-7 gap-1">
						{dates.map((day) => (
							<DayChip
								key={day}
								active={days.includes(day)}
								onClick={() => onChange(false, toggled(days, day), [])}
								label={day}
							/>
						))}
						<DayChip
							active={days.includes(lastDayOfMonth)}
							onClick={() => onChange(false, toggled(days, lastDayOfMonth), [])}
							label={<Trans>Last day</Trans>}
							className="col-span-4 px-2"
						/>
					</div>
					<span className="text-xs text-muted-foreground">
						<Trans>A day missing in a month, such as the 31st, is skipped: choose the last day for the end of each month.</Trans>
					</span>
				</div>
			)}
		</div>
	)
}
