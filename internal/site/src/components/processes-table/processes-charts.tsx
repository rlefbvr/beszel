import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { useMemo } from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { useYAxisWidth } from "@/components/charts/hooks"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { chartMargin, cn, decimalString, hourWithSeconds, useBrowserStorage } from "@/lib/utils"
import { formatRate, type ProcessRow, processKey } from "./process-format"

/** Use of a process at a reading */
interface ProcessPoint {
	name: string
	pid: number
	started?: number
	cpu: number
	mem: number
	disk: number
}

/** A reading of the processes of a host */
interface ProcessSample {
	time: number
	points: Map<string, ProcessPoint>
}

type Metric = "cpu" | "mem" | "disk"

/** Readings kept for the charts: 30 minutes at one reading every 15 seconds */
const maxSamples = 120

/** Readings of each host, kept while the site is open (switching tabs or pages keeps them) */
const histories = new Map<string, ProcessSample[]>()

/** Adds a reading of the processes of a host to its history, and returns the history */
export function recordProcesses(systemId: string, rows: ProcessRow[]) {
	const points = new Map<string, ProcessPoint>()
	for (const row of rows) {
		const cpu = row.cpu ?? 0
		const mem = row.mem ?? 0
		const disk = (row.dr ?? 0) + (row.dw ?? 0)
		if (cpu || mem || disk) {
			points.set(processKey(row), { name: row.name, pid: row.pid, started: row.started, cpu, mem, disk })
		}
	}
	const history = [...(histories.get(systemId) ?? []), { time: Date.now(), points }].slice(-maxSamples)
	histories.set(systemId, history)
	return history
}

export const processesHistory = (systemId: string) => histories.get(systemId) ?? []

/** Keys of the processes that used the most of a resource over the history */
function topKeys(history: ProcessSample[], metric: Metric, count: number) {
	const sums = new Map<string, number>()
	for (const sample of history) {
		for (const [key, point] of sample.points) {
			sums.set(key, (sums.get(key) ?? 0) + point[metric])
		}
	}
	return [...sums]
		.filter(([, sum]) => sum > 0)
		.sort((a, b) => b[1] - a[1])
		.slice(0, count)
		.map(([key]) => key)
}

const percentTick = (value: number) => `${decimalString(value, value >= 10 ? 0 : 1)}%`
const percentValue = (value: number) => `${decimalString(value, value >= 10 ? 1 : 2)}%`

const topChoices = [5, 10, 20]

/**
 * Stacked areas of the processes that use the most CPU, memory and disk on a
 * host, over the readings made while the page is open. A click on an area
 * opens the process.
 */
export function ProcessesCharts({
	history,
	onSelect,
}: {
	history: ProcessSample[]
	onSelect: (process: ProcessPoint) => void
}) {
	const [top, setTop] = useBrowserStorage("processes-top", 10)

	const charts = useMemo(() => {
		const metrics: { id: Metric; title: string; tick: (value: number) => string; value: (v: number) => string }[] = [
			{ id: "cpu", title: t`CPU Usage`, tick: percentTick, value: percentValue },
			{ id: "mem", title: t`Memory Usage`, tick: percentTick, value: percentValue },
			{ id: "disk", title: t`Disk I/O`, tick: (value) => (value ? formatRate(value) : "0"), value: formatRate },
		]
		return metrics.map((metric) => {
			const keys = topKeys(history, metric.id, top)
			const data = history.map((sample) => {
				const row: Record<string, number> = { time: sample.time }
				for (const key of keys) {
					row[key] = sample.points.get(key)?.[metric.id] ?? 0
				}
				return row
			})
			return { ...metric, keys, data }
		})
	}, [history, top])

	// the last reading of each process, for its name and to open it once it ended
	const points = useMemo(() => {
		const latest = new Map<string, ProcessPoint>()
		for (const sample of history) {
			for (const [key, point] of sample.points) {
				latest.set(key, point)
			}
		}
		return latest
	}, [history])

	// a process keeps its color in the three charts
	const colors = useMemo(() => {
		const map = new Map<string, string>()
		for (const chart of charts) {
			for (const key of chart.keys) {
				if (!map.has(key)) {
					map.set(key, `hsl(${(map.size * 137.508 + 210) % 360}, 65%, 52%)`)
				}
			}
		}
		return map
	}, [charts])

	return (
		<div className="mb-4">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-2 px-1">
				<p className="text-sm text-muted-foreground me-auto">
					{history.length < 2 ? (
						<Trans>The charts fill in while this page is open, with a reading every 15 seconds.</Trans>
					) : (
						<Trans>Processes that use the most resources since this page was opened. Click an area to see the process.</Trans>
					)}
				</p>
				<div className="flex rounded-md border p-0.5 gap-0.5" role="radiogroup">
					{topChoices.map((count) => (
						<button
							key={count}
							type="button"
							role="radio"
							aria-checked={top === count}
							onClick={() => setTop(count)}
							className={cn(
								"px-2.5 h-7 rounded text-xs font-medium transition-colors",
								top === count ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
							)}
						>
							<Trans>Top {count}</Trans>
						</button>
					))}
				</div>
			</div>
			<div className="grid gap-3 lg:grid-cols-3">
				{charts.map((chart) => (
					<div key={chart.id} className="rounded-md border p-3 pb-1">
						<h4 className="text-sm font-medium mb-1 ms-1">{chart.title}</h4>
						<div className="h-48 relative">
							{history.length < 2 ? (
								<div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
									<Trans>Waiting for the next reading…</Trans>
								</div>
							) : (
								<ProcessChart
									data={chart.data}
									keys={chart.keys}
									colors={colors}
									points={points}
									tick={chart.tick}
									value={chart.value}
									onSelect={onSelect}
								/>
							)}
						</div>
					</div>
				))}
			</div>
		</div>
	)
}

function ProcessChart({
	data,
	keys,
	colors,
	points,
	tick,
	value,
	onSelect,
}: {
	data: Record<string, number>[]
	keys: string[]
	colors: Map<string, string>
	points: Map<string, ProcessPoint>
	tick: (value: number) => string
	value: (value: number) => string
	onSelect: (process: ProcessPoint) => void
}) {
	const { yAxisWidth, updateYAxisWidth } = useYAxisWidth()
	const label = (key: string) => {
		const point = points.get(key)
		return point ? `${point.name} (${point.pid})` : key
	}
	return (
		<ChartContainer className={cn("h-full w-full absolute aspect-auto opacity-0", yAxisWidth && "opacity-100")}>
			<AreaChart data={data} margin={chartMargin}>
				<CartesianGrid vertical={false} />
				<YAxis
					direction="ltr"
					className="tracking-tighter"
					width={yAxisWidth}
					domain={[0, "auto"]}
					tickFormatter={(v) => updateYAxisWidth(tick(v))}
					tickLine={false}
					axisLine={false}
				/>
				<XAxis
					dataKey="time"
					type="number"
					scale="time"
					domain={["dataMin", "dataMax"]}
					tickFormatter={(time) => hourWithSeconds(time)}
					minTickGap={40}
					tickLine={false}
					axisLine={false}
				/>
				<ChartTooltip
					animationDuration={150}
					// @ts-expect-error
					itemSorter={(a, b) => b.value - a.value}
					content={
						<ChartTooltipContent
							labelFormatter={(_, payload) => hourWithSeconds(payload[0]?.payload.time)}
							contentFormatter={(item) => value((item as { value: number }).value)}
							truncate
						/>
					}
				/>
				{keys.map((key) => (
					<Area
						key={key}
						dataKey={key}
						name={label(key)}
						stackId="processes"
						type="monotoneX"
						fill={colors.get(key)}
						fillOpacity={0.4}
						stroke={colors.get(key)}
						isAnimationActive={false}
						className="cursor-pointer"
						onClick={() => {
							const point = points.get(key)
							point && onSelect(point)
						}}
					/>
				))}
			</AreaChart>
		</ChartContainer>
	)
}
