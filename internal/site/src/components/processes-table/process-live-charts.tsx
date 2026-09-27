import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { LoaderCircleIcon, PauseIcon, PlayIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Area, AreaChart, XAxis, YAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { pb } from "@/lib/api"
import { decimalString, hourWithSeconds } from "@/lib/utils"
import { formatRate, type ProcessRow, processKey } from "./process-format"
import { processesHistory, recordProcesses } from "./processes-charts"

/** Readings while the details of a process are open */
const readEvery = 5_000

type Metric = "cpu" | "mem" | "disk"

const percentValue = (value: number) => `${decimalString(value, value >= 10 ? 1 : 2)}%`

/**
 * The reading of the process when its start time differs slightly from one
 * reading to the next: the same PID started within 2 seconds.
 */
function samePid<T extends { pid: number; started?: number }>(points: Iterable<T>, process: ProcessRow) {
	for (const point of points) {
		if (point.pid === process.pid && Math.abs((point.started ?? 0) - (process.started ?? 0)) <= 2) {
			return point
		}
	}
	return undefined
}

/**
 * The use of a process next to the use of its host, in three small stacked
 * charts (the process, then the other processes): read every 5 seconds while
 * the details are open, from the readings the page already made.
 */
export function ProcessLiveCharts({
	process,
	onReading,
}: {
	process: ProcessRow
	/** the process in each new reading, to show its values */
	onReading?: (process: ProcessRow) => void
}) {
	const system = process.system
	const key = processKey(process)
	const [history, setHistory] = useState(() => processesHistory(system))
	const [paused, setPaused] = useState(false)
	const [loading, setLoading] = useState(false)
	const busy = useRef(false)

	const read = useCallback(async () => {
		if (busy.current || document.hidden) {
			return
		}
		busy.current = true
		setLoading(true)
		try {
			const res = await pb.send<{ processes: Omit<ProcessRow, "system">[] }>("/api/beszel/processes", {
				query: { system },
				requestKey: null,
			})
			const rows = res.processes.map((row) => ({ ...row, system }))
			setHistory(recordProcesses(system, rows))
			const current = rows.find((row) => processKey(row) === key) ?? samePid(rows, process)
			if (current) {
				onReading?.(current)
			}
		} catch {
			// the charts keep their readings; the next one may answer
		} finally {
			busy.current = false
			setLoading(false)
		}
	}, [system, key])

	useEffect(() => {
		if (paused) {
			return
		}
		read()
		const timer = setInterval(read, readEvery)
		return () => clearInterval(timer)
	}, [paused, read])

	const data = useMemo(
		() =>
			history.map((sample) => {
				const point = sample.points.get(key) ?? samePid(sample.points.values(), process)
				const totals = { cpu: 0, mem: 0, disk: 0 }
				for (const other of sample.points.values()) {
					totals.cpu += other.cpu
					totals.mem += other.mem
					totals.disk += other.disk
				}
				const row: Record<string, number> = { time: sample.time }
				for (const metric of ["cpu", "mem", "disk"] as const) {
					const own = point?.[metric] ?? 0
					row[`${metric}Own`] = own
					row[`${metric}Others`] = Math.max(totals[metric] - own, 0)
				}
				return row
			}),
		[history, key]
	)

	const charts: { metric: Metric; title: string; format: (value: number) => string }[] = [
		{ metric: "cpu", title: t`CPU`, format: percentValue },
		{ metric: "mem", title: t`Memory`, format: percentValue },
		{ metric: "disk", title: t`Disk I/O`, format: (value) => (value ? formatRate(value) : "0") },
	]

	return (
		<div className="grid gap-2">
			<div className="flex items-center gap-2">
				<span className="text-sm font-medium me-auto">
					<Trans>Use of the process and of its host</Trans>
				</span>
				{loading && !paused && <LoaderCircleIcon className="size-3.5 animate-spin text-muted-foreground" />}
				<Button
					type="button"
					variant="outline"
					size="icon"
					className="size-8"
					onClick={() => setPaused(!paused)}
					aria-label={paused ? t`Refresh automatically` : t`Pause the refresh`}
					title={paused ? t`Refresh automatically` : t`Pause the refresh`}
				>
					{paused ? <PlayIcon className="size-3.5" /> : <PauseIcon className="size-3.5" />}
				</Button>
			</div>
			<div className="grid gap-2 sm:grid-cols-3">
				{charts.map((chart) => (
					<div key={chart.metric} className="rounded-md border p-2 pb-0">
						<span className="text-xs text-muted-foreground ms-1">{chart.title}</span>
						<div className="h-24 relative">
							{data.length < 2 ? (
								<div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
									<Trans>Waiting for the next reading…</Trans>
								</div>
							) : (
								<ChartContainer className="h-full w-full absolute aspect-auto">
									<AreaChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
										<YAxis hide domain={[0, "auto"]} />
										<XAxis dataKey="time" type="number" scale="time" domain={["dataMin", "dataMax"]} hide />
										<ChartTooltip
											animationDuration={100}
											content={
												<ChartTooltipContent
													labelFormatter={(_, payload) => hourWithSeconds(payload[0]?.payload.time)}
													contentFormatter={(item) => chart.format((item as { value: number }).value)}
												/>
											}
										/>
										<Area
											dataKey={`${chart.metric}Own`}
											name={process.name}
											stackId="use"
											type="monotoneX"
											fill="hsl(199, 89%, 48%)"
											fillOpacity={0.5}
											stroke="hsl(199, 89%, 48%)"
											isAnimationActive={false}
										/>
										<Area
											dataKey={`${chart.metric}Others`}
											name={t`Other processes`}
											stackId="use"
											type="monotoneX"
											fill="var(--muted-foreground)"
											fillOpacity={0.15}
											stroke="var(--muted-foreground)"
											strokeOpacity={0.4}
											isAnimationActive={false}
										/>
									</AreaChart>
								</ChartContainer>
							)}
						</div>
					</div>
				))}
			</div>
		</div>
	)
}
