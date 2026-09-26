import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { HistoryIcon } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

/** Periods of the lists by date, in hours */
export const periods = {
	"1h": { hours: 1, label: () => t`1 hour` },
	"24h": { hours: 24, label: () => t`24 hours` },
	"7d": { hours: 24 * 7, label: () => t`7 days` },
	"30d": { hours: 24 * 30, label: () => t`30 days` },
	"90d": { hours: 24 * 90, label: () => t`90 days` },
	"1y": { hours: 24 * 365, label: () => t`1 year` },
}

/** A period of the list, "all" for no limit, or "custom" for the dates chosen */
export type Period = keyof typeof periods | "all" | "custom"

/** Start of a local day (yyyy-mm-dd), shifted by a number of days */
export function localDay(value: string, addDays = 0) {
	const [year, month, day] = value.split("-").map(Number)
	return new Date(year, month - 1, day + addDays)
}

/** Dates of a period: start and end, null when not limited */
export function periodRange(period: Period, from: string, to: string): { start: Date | null; end: Date | null } {
	if (period === "custom") {
		return { start: from ? localDay(from) : null, end: to ? localDay(to, 1) : null }
	}
	if (period === "all") {
		return { start: null, end: null }
	}
	return { start: new Date(Date.now() - periods[period].hours * 3_600_000), end: null }
}

/**
 * Choice of a period like the charts of a system (1 hour, 24 hours…), or of
 * dates, shown next to it when "Dates…" is chosen.
 */
export function PeriodSelect({
	id,
	period,
	from,
	to,
	onPeriodChange,
	onFromChange,
	onToChange,
	allowAll = false,
}: {
	id: string
	period: Period
	from: string
	to: string
	onPeriodChange: (period: Period) => void
	onFromChange: (value: string) => void
	onToChange: (value: string) => void
	/** offer "All time", without limit */
	allowAll?: boolean
}) {
	return (
		<>
			<Select value={period} onValueChange={(value) => onPeriodChange(value as Period)}>
				<SelectTrigger className="w-auto min-w-44 gap-3 whitespace-nowrap relative ps-10 pe-4" aria-label={t`Period`}>
					<HistoryIcon className="h-4 w-4 absolute start-4 top-1/2 -translate-y-1/2 opacity-85" />
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{(Object.keys(periods) as (keyof typeof periods)[]).map((key) => (
						<SelectItem key={key} value={key}>
							{periods[key].label()}
						</SelectItem>
					))}
					{allowAll && (
						<SelectItem value="all">
							<Trans>All time</Trans>
						</SelectItem>
					)}
					<SelectItem value="custom">
						<Trans>Dates…</Trans>
					</SelectItem>
				</SelectContent>
			</Select>
			{period === "custom" && (
				<>
					<div className="flex items-center gap-2">
						<Label htmlFor={`${id}-from`}>
							<Trans>From</Trans>
						</Label>
						<Input
							id={`${id}-from`}
							type="date"
							value={from}
							max={to || undefined}
							onChange={(e) => onFromChange(e.target.value)}
							className="w-40 tabular-nums"
						/>
					</div>
					<div className="flex items-center gap-2">
						<Label htmlFor={`${id}-to`}>
							<Trans>To</Trans>
						</Label>
						<Input
							id={`${id}-to`}
							type="date"
							value={to}
							min={from || undefined}
							onChange={(e) => onToChange(e.target.value)}
							className="w-40 tabular-nums"
						/>
					</div>
				</>
			)}
		</>
	)
}
