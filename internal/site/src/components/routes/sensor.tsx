import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { getPagePath } from "@nanostores/router"
import {
	ArrowUpDownIcon,
	BellIcon,
	CirclePauseIcon,
	CirclePlayIcon,
	ClockIcon,
	FolderIcon,
	GlobeIcon,
	InfoIcon,
	LoaderCircleIcon,
	PenSquareIcon,
	RouteIcon,
	ShieldCheckIcon,
	Trash2Icon,
} from "lucide-react"
import { atom } from "nanostores"
import { memo, type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import ChartTimeSelect from "@/components/charts/chart-time-select"
import type { DataPoint } from "@/components/charts/line-chart"
import LineChartDefault from "@/components/charts/line-chart"
import { FooterRepoLink } from "@/components/footer-repo-link"
import { QuietHoursBanner, QuietHoursButton } from "@/components/quiet-hours-banner"
import { $router, navigate } from "@/components/router"
import { ChartCard } from "@/components/routes/system/chart-card"

import { CheckBadge, checkStatusLabel, heartbeatWindow, QualityBadge, SensorDot, SensorHeartbeat } from "@/components/sensors/sensor-badges"
import { SensorAlerts } from "@/components/sensors/sensor-alerts"
import { HostBadge, HostLinkButton, LinkedSystemDeleteOption } from "@/components/sensors/host-links"
import { SensorCertDialog } from "@/components/sensors/sensor-cert"
import { TracerouteDialog } from "@/components/sensors/traceroute-dialog"
import { intervalLabel, SensorDialog } from "@/components/sensors/sensor-dialog"
import { SensorIncidents } from "@/components/sensors/sensor-incidents"
import { formatMs, formatPercent } from "@/components/sensors/sensors-board"
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { toast } from "@/components/ui/use-toast"
import { isReadOnlyUser, pb } from "@/lib/api"
import { usePageTitle } from "@/lib/instance"
import { rememberRecent } from "@/lib/recent"
import { $sensorAlerts, alertsOfSensor, sensorAlertName } from "@/lib/sensor-alerts"
import { sumStats, useSensorStats } from "@/lib/sensor-stats"
import { $checksBySensor, $sensors, $sensorsLoaded, checkColor, checkName, protocolTransport, sensorColor } from "@/lib/sensors"
import { $direction, $userSettings } from "@/lib/stores"
import { formatDateTime, formatRelativeTime, useNow } from "@/lib/time"
import { chartTimeData, cn, decimalString, parseSemVer } from "@/lib/utils"
import type { ChartData, ChartTimes, SensorCheckRecord, SensorRecord, SensorStatsRecord } from "@/types"

/** Colors of the quality chart, like the state badges */
const qualityColors = {
	green: "var(--color-green-500, #22c55e)",
	orange: "var(--color-orange-500, #f97316)",
	red: "var(--color-red-500, #ef4444)",
	grey: "var(--muted-foreground)",
}

/** Stats of the checks by time, in the format of the charts: { created, stats: { check: values } } */
interface SensorChartRecord {
	created: number
	stats: Record<string, { res: number | null; loss: number }>
}

function chartRecords(stats: SensorStatsRecord[]): SensorChartRecord[] {
	const byTime = new Map<number, SensorChartRecord>()
	for (const record of stats) {
		let entry = byTime.get(record.created)
		if (!entry) {
			entry = { created: record.created, stats: {} }
			byTime.set(record.created, entry)
		}
		entry.stats[record.check] = {
			res: record.success_count ? record.res_sum / record.success_count / 1000 : null,
			loss: record.total_count ? ((record.total_count - record.success_count) * 100) / record.total_count : 0,
		}
		// all the checks together, for the quality chart
		const all = entry.stats.all ?? { res: null, loss: 0 }
		const totals = sumStats(stats.filter((r) => r.created === record.created))
		all.loss = totals.loss ?? 0
		all.res = totals.res
		entry.stats.all = all
	}
	return [...byTime.values()].sort((a, b) => a.created - b.created)
}

export default memo(function SensorPage({ id }: { id: string }) {
	const sensor = useStore($sensors)[id]
	const { loaded } = useStore($sensorsLoaded)
	usePageTitle(sensor?.name ?? "")
	if (!sensor) {
		return (
			<div className="py-14 text-center text-muted-foreground">
				{loaded ? <Trans>Sensor not found.</Trans> : <LoaderCircleIcon className="size-5 animate-spin mx-auto" />}
			</div>
		)
	}
	return <SensorDetail sensor={sensor} />
})

function SensorDetail({ sensor }: { sensor: SensorRecord }) {
	const sensorName = sensor.name
	useEffect(() => rememberRecent({ kind: "sensor", id: sensor.id, name: sensorName }), [sensor.id, sensorName])
	const checks = useStore($checksBySensor)[sensor.id] ?? []
	const direction = useStore($direction)
	const [chartTimeStore] = useState(() => {
		const defaultTime = $userSettings.get().chartTime
		return atom<ChartTimes>(defaultTime === "1m" ? "24h" : (defaultTime ?? "24h"))
	})
	const chartTime = useStore(chartTimeStore)
	const { stats, loading } = useSensorStats(sensor.id, chartTime)
	const [alertsOpen, setAlertsOpen] = useState(false)
	const [certOpen, setCertOpen] = useState(false)
	const [traceOpen, setTraceOpen] = useState(false)
	const [editOpen, setEditOpen] = useState(false)
	const [deleteOpen, setDeleteOpen] = useState(false)
	// host to delete with the sensor, chosen in the confirmation
	const linkedSystem = useRef<string | null>(null)
	const readOnly = isReadOnlyUser()
	const now = useNow()

	const totals = useMemo(() => sumStats(stats), [stats])
	const records = useMemo(() => chartRecords(stats), [stats])
	const chartData = useMemo<ChartData>(
		() => ({ agentVersion: parseSemVer("0.20.0"), orientation: direction === "rtl" ? "right" : "left", chartTime }),
		[direction, chartTime]
	)
	const certExpiry = checks
		.map((check) => check.cert_expiry)
		.filter(Boolean)
		.sort()[0]
	const certDays = certExpiry ? Math.floor((new Date(certExpiry).getTime() - now.getTime()) / 86_400_000) : null
	const periodLabel = chartTimeData[chartTime]?.label()
	const every = intervalLabel(sensor.interval || 60)
	const uptimeValue = formatPercent(totals.uptime)
	const lossValue = formatPercent(totals.loss)

	const togglePause = async () => {
		try {
			await pb.collection("sensors").update(sensor.id, { paused: !sensor.paused })
		} catch (e) {
			toast({ variant: "destructive", title: t`Error`, description: (e as Error).message })
		}
	}
	const deleteSensor = async () => {
		try {
			await pb.collection("sensors").delete(sensor.id)
			// the host of the same address, when chosen
			if (linkedSystem.current) {
				await pb.collection("systems").delete(linkedSystem.current)
			}
			navigate(getPagePath($router, "monitors"))
		} catch (e) {
			toast({ variant: "destructive", title: t`Error`, description: (e as Error).message })
		}
	}

	return (
		<>
			<div className="grid gap-4 mb-14">
				<Card>
					<div className="grid xl:flex xl:gap-4 px-4 sm:px-6 pt-3 sm:pt-4 pb-5">
						<div className="min-w-0 grid gap-2">
							<h1 className="text-2xl sm:text-[1.6rem] font-semibold flex flex-wrap items-center gap-3">
								<SensorDot sensor={sensor} className="size-3" />
								{sensor.name}
								<QualityBadge sensor={sensor} />
								<HostBadge host={sensor.host} className="gap-1.5 px-2 text-xs" />
							</h1>
							<div className="flex flex-wrap items-center gap-3 text-sm opacity-90">
								<HeaderItem label={t`Host / IP`}>
									<GlobeIcon className="size-4" />
									{sensor.host}
								</HeaderItem>
								{sensor.group && (
									<>
										<Separator orientation="vertical" className="h-4 bg-primary/30" />
										<HeaderItem label={t`Group`}>
											<FolderIcon className="size-4" />
											{sensor.group}
										</HeaderItem>
									</>
								)}
								{sensor.description && (
									<>
										<Separator orientation="vertical" className="h-4 bg-primary/30" />
										<HeaderItem label={t`Information`}>
											<InfoIcon className="size-4" />
											{sensor.description}
										</HeaderItem>
									</>
								)}
								{sensor.last_check && (
									<>
										<Separator orientation="vertical" className="h-4 bg-primary/30" />
										<HeaderItem label={t`Last update`} className="text-muted-foreground">
											<ClockIcon className="size-4" />
											{formatRelativeTime(new Date(sensor.last_check), now)}
										</HeaderItem>
									</>
								)}
								{checks.length > 0 && (
									<>
										<Separator orientation="vertical" className="h-4 bg-primary/30" />
										<span className="flex flex-wrap items-center gap-1.5">
											{checks.map((check) => (
												<CheckBadge key={check.id} check={check} className="text-xs" />
											))}
										</span>
									</>
								)}
								</div>
						</div>
						<div className="xl:ms-auto flex flex-wrap items-center gap-2 mt-3 xl:mt-0 self-center">
							<HostLinkButton host={sensor.host} />
							<AlertsButton sensor={sensor} checks={checks} onClick={() => setAlertsOpen(true)} />
							<QuietHoursButton sensorId={sensor.id} />
							{!readOnly && (
								<ToolbarButton label="Traceroute" onClick={() => setTraceOpen(true)}>
									<RouteIcon className="size-4" />
								</ToolbarButton>
							)}
							{!readOnly && (
								<>
									<ToolbarButton label={t`Edit`} onClick={() => setEditOpen(true)}>
										<PenSquareIcon className="size-4" />
									</ToolbarButton>
									<ToolbarButton label={sensor.paused ? t`Resume` : t`Pause`} onClick={togglePause}>
										{sensor.paused ? <CirclePlayIcon className="size-4" /> : <CirclePauseIcon className="size-4" />}
									</ToolbarButton>
									<ToolbarButton label={t`Delete`} onClick={() => setDeleteOpen(true)}>
										<Trash2Icon className="size-4" />
									</ToolbarButton>
								</>
							)}
							<ChartTimeSelect
								className="w-full sm:w-auto sm:min-w-40 whitespace-nowrap"
								agentVersion={chartData.agentVersion}
								chartTimeStore={chartTimeStore}
								allowRealtime={false}
							/>
						</div>
					</div>
				</Card>

				<QuietHoursBanner sensorId={sensor.id} />

				<div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
					<StatCard title={<Trans>Uptime ({periodLabel})</Trans>} value={uptimeValue} loading={loading} />
					<StatCard title={<Trans>Uptime (24h)</Trans>} value={formatPercent(sensor.uptime)} />
					<StatCard title={<Trans>Average response</Trans>} value={formatMs(totals.res)} loading={loading} />
					<StatCard title={<Trans>Packet loss ({periodLabel})</Trans>} value={lossValue} loading={loading} />
					<StatCard
						title={<Trans>TLS certificate</Trans>}
						value={certDays === null ? "-" : t`${certDays} days`}
						hint={certExpiry ? formatDateTime(certExpiry) : undefined}
						icon={<ShieldCheckIcon className={cn("size-4", certDays !== null && certDays < 14 && "text-orange-500")} />}
						onClick={checks.some((check) => check.cert) ? () => setCertOpen(true) : undefined}
					/>
				</div>

				<Card className="px-4 py-4 sm:px-6 grid gap-2">
					<div className="flex items-center justify-between text-sm">
						<span className="font-medium">
							{heartbeatWindow(sensor.interval || 60) < 3600 ? <Trans>Last 30 minutes</Trans> : <Trans>Last hour</Trans>}
						</span>
						<span className="text-muted-foreground">
							<Trans>One bar per interval ({every})</Trans>
						</span>
					</div>
					<SensorHeartbeat sensorId={sensor.id} interval={sensor.interval || 60} />
				</Card>

				<div className="grid xl:grid-cols-2 gap-4">
					<ResponseChart records={records} checks={checks} chartData={chartData} empty={!records.length} />
					<QualityChart records={records} sensor={sensor} chartData={chartData} empty={!records.length} />
				</div>

				<ChecksCard checks={checks} now={now} stats={stats} periodLabel={periodLabel} />

				<SensorIncidents sensorId={sensor.id} />
			</div>
			<FooterRepoLink />

			<Sheet open={alertsOpen} onOpenChange={setAlertsOpen}>
				<SheetContent className="max-h-full overflow-auto w-160 !max-w-full p-4 sm:p-6">
					{alertsOpen && <SensorAlerts sensor={sensor} />}
				</SheetContent>
			</Sheet>
			<Dialog open={traceOpen} onOpenChange={setTraceOpen}>
				{traceOpen && <TracerouteDialog sensor={sensor} />}
			</Dialog>
			<Dialog open={certOpen} onOpenChange={setCertOpen}>
				{certOpen && <SensorCertDialog checks={checks} />}
			</Dialog>
			<Dialog open={editOpen} onOpenChange={setEditOpen}>
				{editOpen && <SensorDialog sensor={sensor} onDone={() => setEditOpen(false)} />}
			</Dialog>
			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							<Trans>Delete this sensor?</Trans>
						</AlertDialogTitle>
						<AlertDialogDescription>
							<Trans>Its checks, history and interruptions will be deleted.</Trans>
						</AlertDialogDescription>
						</AlertDialogHeader>
						<LinkedSystemDeleteOption host={sensor.host} onChange={(systemId) => {
						linkedSystem.current = systemId
					}} />
					<AlertDialogFooter>
						<AlertDialogCancel>
							<Trans>Cancel</Trans>
						</AlertDialogCancel>
						<AlertDialogAction className={cn(buttonVariants({ variant: "destructive" }))} onClick={deleteSensor}>
							<Trans>Delete</Trans>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}

/** Opens the alerts of the sensor; the bell is filled when alerts are set, listed in its tooltip */
function AlertsButton({
	sensor,
	checks,
	onClick,
}: {
	sensor: SensorRecord
	checks: SensorCheckRecord[]
	onClick: () => void
}) {
	const alerts = alertsOfSensor(useStore($sensorAlerts), sensor.id)
	const portNames = (ids: string[] = []) =>
		checks
			.filter((check) => ids.includes(check.id))
			.map(checkName)
			.join(", ")
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button variant="outline" size="icon" aria-label={t`Alerts`} onClick={onClick}>
					<BellIcon className={cn("size-4", alerts.length > 0 && "fill-primary")} />
				</Button>
			</TooltipTrigger>
			<TooltipContent className="max-w-72">
				{alerts.length ? (
					<ul className="grid gap-0.5">
						{alerts.map((alert) => (
							<li key={alert.id}>
								<span className={cn("font-medium", alert.triggered && "text-red-500")}>
									{sensorAlertName(alert.name)}
								</span>
								{alert.name === "port" && alert.checks?.length ? (
									<span className="text-muted-foreground"> · {portNames(alert.checks)}</span>
								) : null}
								{(alert.name === "loss" || alert.name === "latency") && (
									<span className="tabular-nums">
										{" "}
										&gt; {alert.value}
										{alert.name === "loss" ? "%" : " ms"}
									</span>
								)}
								{alert.name === "cert" && (
									<span className="tabular-nums">
										{" "}
										&lt; {alert.value} {t`days`}
									</span>
								)}
							</li>
						))}
					</ul>
				) : (
					<Trans>No alerts configured</Trans>
				)}
			</TooltipContent>
		</Tooltip>
	)
}

/** Address pinged and statistics of an ICMP check over the period */
function PingDetails({
	check,
	stats,
	periodLabel,
}: {
	check: SensorCheckRecord
	stats: ReturnType<typeof pingStats>
	periodLabel?: string
}) {
	// the message of a successful ping is the address pinged
	const ip = check.status !== "down" && /^[0-9a-fA-F.:]+$/.test(check.message ?? "") ? check.message : ""
	return (
		<span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-muted-foreground tabular-nums">
			{ip && <span className="text-foreground">{ip}</span>}
			{check.status === "down" && check.message && <span className="truncate">{check.message}</span>}
			{stats && (
				<span title={periodLabel}>
					min {formatMs(stats.min)} · <Trans>avg</Trans> {formatMs(stats.avg)} · max {formatMs(stats.max)} ·{" "}
					<Trans comment="Packet loss">loss</Trans> {formatPercent(stats.loss)}
				</span>
			)}
		</span>
	)
}

/** Item of the header of the sensor, with a tooltip naming it */
function HeaderItem({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className={cn("flex items-center gap-1.5", className)}>{children}</span>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	)
}

function ToolbarButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button variant="outline" size="icon" aria-label={label} onClick={onClick}>
					{children}
				</Button>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	)
}

function StatCard({
	title,
	value,
	hint,
	icon,
	loading,
	onClick,
}: {
	title: ReactNode
	value: string
	hint?: string
	icon?: ReactNode
	loading?: boolean
	/** makes the card a button, such as the one opening the certificate details */
	onClick?: () => void
}) {
	const card = (
		<Card className={cn("px-4 py-3.5 grid gap-1 h-full", onClick && "transition-colors group-hover:bg-accent/40")}>
			<span className="text-xs text-muted-foreground flex items-center gap-1.5">
				{icon}
				{title}
			</span>
			<span className="text-xl font-semibold tabular-nums">
				{loading ? <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" /> : value}
			</span>
			{hint && <span className="text-xs text-muted-foreground tabular-nums">{hint}</span>}
		</Card>
	)
	if (!onClick) {
		return card
	}
	return (
		<button type="button" onClick={onClick} className="group text-start rounded-xl cursor-pointer">
			{card}
		</button>
	)
}

/** Average response time of each check */
function ResponseChart({
	records,
	checks,
	chartData,
	empty,
}: {
	records: SensorChartRecord[]
	checks: SensorCheckRecord[]
	chartData: ChartData
	empty: boolean
}) {
	const dataPoints = useMemo<DataPoint<SensorChartRecord>[]>(
		() =>
			checks.map((check, i) => ({
				label: checkName(check),
				dataKey: (record: SensorChartRecord) => record.stats[check.id]?.res ?? null,
				// the color of the pill of the check
				color: checkColor(check),
				order: i,
			})),
		[checks]
	)
	return (
		<ChartCard empty={empty} title={t`Response`} description={t`Average response time of each check`} legend>
			<LineChartDefault
				truncate
				chartData={chartData}
				customData={records}
				dataPoints={dataPoints}
				domain={["auto", "auto"]}
				connectNulls
				legend={dataPoints.length > 1}
				tickFormatter={(value) => `${decimalString(value, value < 10 ? 1 : 0)} ms`}
				contentFormatter={({ value }) => (typeof value === "number" ? formatMs(value) : value)}
			/>
		</ChartCard>
	)
}

/** Packet loss of all the checks, in the color of the quality of the sensor */
function QualityChart({
	records,
	sensor,
	chartData,
	empty,
}: {
	records: SensorChartRecord[]
	sensor: SensorRecord
	chartData: ChartData
	empty: boolean
}) {
	const color = qualityColors[sensorColor(sensor)]
	const dataPoints = useMemo<DataPoint<SensorChartRecord>[]>(
		() => [
			{
				label: t({ message: "Loss", context: "Packet loss" }),
				dataKey: (record: SensorChartRecord) => record.stats.all?.loss ?? null,
				color,
				order: 0,
			},
		],
		[color]
	)
	return (
		<ChartCard
			empty={empty}
			title={t`Packet quality`}
			description={t`Packet loss (%) of all the checks`}
			legend={false}
		>
			<LineChartDefault
				truncate
				chartData={chartData}
				customData={records}
				dataPoints={dataPoints}
				domain={[0, 100]}
				connectNulls
				tickFormatter={(value) => `${decimalString(value, 0)}%`}
				contentFormatter={({ value }) => (typeof value === "number" ? formatPercent(value) : value)}
			/>
		</ChartCard>
	)
}

type CheckSortKey = "check" | "port" | "status" | "res" | "code" | "message" | "last_check"

/** Value of a check compared by a column of the checks table */
function checkSortValue(check: SensorCheckRecord, key: CheckSortKey): string | number {
	switch (key) {
		case "check":
			return checkName(check).toLowerCase()
		case "port":
			return check.port
		case "status":
			return check.status === "down" ? 0 : check.status === "up" ? 2 : 1
		case "res":
			return check.status === "up" ? check.res : Number.POSITIVE_INFINITY
		case "code":
			return check.code || 0
		case "message":
			return (check.message ?? "").toLowerCase()
		case "last_check":
			return check.last_check ? new Date(check.last_check).getTime() : 0
	}
}

/** Header of a sortable column of the checks table */
function SortHead({
	name,
	sortKey,
	sort,
	onSort,
	className,
}: {
	name: ReactNode
	sortKey: CheckSortKey
	sort: { key: CheckSortKey; desc: boolean }
	onSort: (key: CheckSortKey) => void
	className?: string
}) {
	const active = sort.key === sortKey
	return (
		<TableHead className={cn("px-2", className)}>
			<Button
				variant="ghost"
				className={cn("h-9 px-2 gap-2", active && "bg-accent/70 light:bg-accent text-accent-foreground/90")}
				onClick={() => onSort(sortKey)}
			>
				{name}
				<ArrowUpDownIcon className="size-4" />
			</Button>
		</TableHead>
	)
}

/** State of each check: response, HTTP code and message, last probe and certificate; sortable by column */
/** Ping statistics of a check over the stats of the period: min, average and max response, and loss */
function pingStats(stats: SensorStatsRecord[], checkId: string) {
	let total = 0
	let success = 0
	let sum = 0
	let min = Number.POSITIVE_INFINITY
	let max = 0
	for (const record of stats) {
		if (record.check !== checkId) {
			continue
		}
		total += record.total_count
		success += record.success_count
		sum += record.res_sum
		if (record.success_count > 0) {
			min = Math.min(min, record.res_min)
			max = Math.max(max, record.res_max)
		}
	}
	if (!total) {
		return null
	}
	return {
		min: success ? min / 1000 : null,
		avg: success ? sum / success / 1000 : null,
		max: success ? max / 1000 : null,
		loss: ((total - success) * 100) / total,
	}
}

function ChecksCard({
	checks,
	now,
	stats,
	periodLabel,
}: {
	checks: SensorCheckRecord[]
	now: Date
	/** stats of the period chosen, for the ping statistics */
	stats: SensorStatsRecord[]
	periodLabel?: string
}) {
	const [sort, setSort] = useState<{ key: CheckSortKey; desc: boolean }>({ key: "check", desc: false })
	const onSort = (key: CheckSortKey) =>
		setSort((current) => ({ key, desc: current.key === key ? !current.desc : false }))
	const sorted = useMemo(() => {
		const list = [...checks]
		list.sort((a, b) => {
			const x = checkSortValue(a, sort.key)
			const y = checkSortValue(b, sort.key)
			const order = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))
			return sort.desc ? -order : order
		})
		return list
	}, [checks, sort])
	const head = { sort, onSort }
	return (
		<Card className="px-3 py-5 sm:py-6 sm:px-6">
			<CardHeader className="p-0 mb-3">
				<CardTitle>
					<Trans>Checks</Trans>
				</CardTitle>
				<CardDescription>
					<Trans>Last result of each check.</Trans>
				</CardDescription>
			</CardHeader>
			<div className="rounded-md border overflow-x-auto">
				<Table>
					<TableHeader>
						<TableRow>
							<SortHead name={<Trans>Check</Trans>} sortKey="check" {...head} />
							<SortHead name={<Trans>Port</Trans>} sortKey="port" {...head} />
							<SortHead name={<Trans>State</Trans>} sortKey="status" {...head} />
							<SortHead name={<Trans>Response</Trans>} sortKey="res" {...head} />
							<SortHead name={<Trans>Code</Trans>} sortKey="code" {...head} />
							<SortHead name={<Trans>Message</Trans>} sortKey="message" className="w-full" {...head} />
							<SortHead name={<Trans>Last check</Trans>} sortKey="last_check" {...head} />
						</TableRow>
					</TableHeader>
					<TableBody>
						{sorted.map((check) => (
							<TableRow key={check.id}>
								<TableCell className="px-4 py-2.5 whitespace-nowrap">
									<CheckBadge check={check} />
								</TableCell>
								<TableCell className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">
									{protocolTransport[check.protocol]}
									{check.port ? ` ${check.port}` : ""}
								</TableCell>
								<TableCell className="px-4 py-2.5 whitespace-nowrap">
									<span className="flex items-center gap-2">
										<SensorDot sensor={{ status: check.status || "pending", quality: "" }} className="size-2" />
										{checkStatusLabel(check)}
									</span>
								</TableCell>
								<TableCell className="px-4 py-2.5 tabular-nums whitespace-nowrap">
									{check.status === "up" ? formatMs(check.res) : "-"}
								</TableCell>
								<TableCell className="px-4 py-2.5 tabular-nums">{check.code || "-"}</TableCell>
								<TableCell className="px-4 py-2.5 max-w-0 w-full">
									{check.protocol === "icmp" ? (
										<PingDetails check={check} stats={pingStats(stats, check.id)} periodLabel={periodLabel} />
									) : (
										<span className="block truncate text-muted-foreground" title={check.message}>
											{check.message || "-"}
										</span>
									)}
								</TableCell>
								<TableCell className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
									{check.last_check ? formatRelativeTime(new Date(check.last_check), now) : "-"}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		</Card>
	)
}
