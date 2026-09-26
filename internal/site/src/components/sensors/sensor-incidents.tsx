import { t } from "@lingui/core/macro"
import { Plural, Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { getPagePath } from "@nanostores/router"
import {
	type Column,
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getSortedRowModel,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table"
import {
	ActivityIcon,
	ArrowUpDownIcon,
	CalendarClockIcon,
	CalendarX2Icon,
	ChevronDownIcon,
	HashIcon,
	HourglassIcon,
	LoaderCircleIcon,
	MessageSquareTextIcon,
	NetworkIcon,
	XIcon,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { type Period, PeriodSelect, periodRange } from "@/components/period-select"
import { $router, Link } from "@/components/router"
import {
	cellWidthStyle,
	ColumnResizer,
	ColumnsViewMenu,
	headerWidthStyle,
	resizedAttr,
	useTableLayout,
} from "@/components/table-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { pb } from "@/lib/api"
import { $sensorChecks, $sensors, checkName } from "@/lib/sensors"
import { formatDateTime, useNow } from "@/lib/time"
import { cn, debounce, formatDuration } from "@/lib/utils"
import type { SensorIncidentRecord } from "@/types"

/** Duration in milliseconds as "2h 5m" */
function formatMs(ms: number) {
	return formatDuration(new Date(0).toISOString(), new Date(Math.max(0, ms)).toISOString()) || "0s"
}

/** Length of an interruption, until now when it lasts */
function incidentDuration(incident: SensorIncidentRecord, now: Date) {
	const end = incident.end ? new Date(incident.end) : now
	return end.getTime() - new Date(incident.start).getTime()
}

/**
 * Interruptions of the checks over a period, with their duration and HTTP code
 * and message; all the sensors, or one with a sensorId.
 */
export function SensorIncidents({ sensorId }: { sensorId?: string }) {
	const sensors = useStore($sensors)
	const checks = useStore($sensorChecks)
	const now = useNow()
	const [period, setPeriod] = useState<Period>("7d")
	const [from, setFrom] = useState("")
	const [to, setTo] = useState("")
	const [sensorsFilter, setSensorsFilter] = useState<string[]>([])
	const [search, setSearch] = useState("")
	const [records, setRecords] = useState<SensorIncidentRecord[]>([])
	const [loading, setLoading] = useState(true)
	const [sorting, setSorting] = useState<SortingState>([{ id: "start", desc: true }])
	const { widths, onColumnResize, columnVisibility, onColumnVisibilityChange } = useTableLayout(
		sensorId ? "sensor-incidents" : "incidents"
	)

	// interruptions overlapping the period: started before its end, ended after its start or ongoing
	const range = useMemo(() => periodRange(period, from, to), [period, from, to])

	useEffect(() => {
		let cancelled = false
		let unsubscribe: (() => void) | undefined
		const conditions: string[] = []
		const params: Record<string, unknown> = {}
		const ids = sensorId ? [sensorId] : sensorsFilter
		if (ids.length) {
			conditions.push(`(${ids.map((_, i) => `sensor = {:sensor${i}}`).join(" || ")})`)
			ids.forEach((id, i) => {
				params[`sensor${i}`] = id
			})
		}
		if (range.start) {
			conditions.push("(end = '' || end >= {:from})")
			params.from = range.start
		}
		if (range.end) {
			conditions.push("start < {:to}")
			params.to = range.end
		}
		const load = async () => {
			setLoading(true)
			try {
				const items = await pb.collection<SensorIncidentRecord>("sensor_incidents").getFullList({
					filter: conditions.length ? pb.filter(conditions.join(" && "), params) : undefined,
					sort: "-start",
					batch: 500,
					requestKey: null,
				})
				if (!cancelled) {
					setRecords(items)
				}
			} catch (e) {
				console.error("get sensor incidents", e)
			} finally {
				if (!cancelled) {
					setLoading(false)
				}
			}
		}
		load()
		const reload = debounce(load, 500)
		pb.collection("sensor_incidents")
			.subscribe("*", ({ record }) => {
				if (!ids.length || ids.includes(record.sensor)) {
					reload()
				}
			})
			.then((fn) => {
				if (cancelled) {
					fn()
				} else {
					unsubscribe = fn
				}
			})
		return () => {
			cancelled = true
			unsubscribe?.()
		}
	}, [sensorId, sensorsFilter.join(","), range])

	const columns = useMemo<ColumnDef<SensorIncidentRecord>[]>(() => {
		const columns: ColumnDef<SensorIncidentRecord>[] = [
			{
				id: "sensor",
				meta: { name: () => t`Sensor` },
				accessorFn: (incident) => sensors[incident.sensor]?.name ?? "",
				sortingFn: "alphanumeric",
				header: ({ column }) => <HeaderButton column={column} name={t`Sensor`} Icon={NetworkIcon} />,
				cell: ({ row }) => (
					<Link
						href={getPagePath($router, "sensor", { id: row.original.sensor })}
						className="font-medium hover:underline"
					>
						{sensors[row.original.sensor]?.name ?? row.original.sensor}
					</Link>
				),
			},
			{
				id: "check",
				meta: { name: () => t`Check` },
				accessorFn: (incident) => (checks[incident.check] ? checkName(checks[incident.check]) : ""),
				sortingFn: "alphanumeric",
				header: ({ column }) => <HeaderButton column={column} name={t`Check`} Icon={ActivityIcon} />,
				cell: ({ getValue }) => getValue() as string,
			},
			{
				id: "start",
				meta: { name: () => t`Start` },
				accessorFn: (incident) => new Date(incident.start).getTime(),
				header: ({ column }) => <HeaderButton column={column} name={t`Start`} Icon={CalendarClockIcon} />,
				cell: ({ row }) => <span className="tabular-nums">{formatDateTime(row.original.start)}</span>,
			},
			{
				id: "end",
				meta: { name: () => t`End` },
				accessorFn: (incident) => (incident.end ? new Date(incident.end).getTime() : Number.MAX_SAFE_INTEGER),
				header: ({ column }) => <HeaderButton column={column} name={t`End`} Icon={CalendarX2Icon} />,
				cell: ({ row }) =>
					row.original.end ? (
						<span className="tabular-nums">{formatDateTime(row.original.end)}</span>
					) : (
						<Badge variant="danger">
							<Trans>Ongoing</Trans>
						</Badge>
					),
			},
			{
				id: "duration",
				meta: { name: () => t`Duration` },
				accessorFn: (incident) => incidentDuration(incident, now),
				header: ({ column }) => <HeaderButton column={column} name={t`Duration`} Icon={HourglassIcon} />,
				cell: ({ getValue }) => <span className="tabular-nums">{formatMs(getValue() as number)}</span>,
			},
			{
				id: "code",
				meta: { name: () => t`Code` },
				accessorFn: (incident) => incident.code,
				header: ({ column }) => <HeaderButton column={column} name={t`Code`} Icon={HashIcon} />,
				cell: ({ row }) =>
					row.original.code ? (
						<Badge variant="outline" className="tabular-nums">
							{row.original.code}
						</Badge>
					) : (
						<span className="text-muted-foreground">-</span>
					),
			},
			{
				id: "message",
				meta: { name: () => t`Message`, grow: true },
				accessorFn: (incident) => incident.message,
				sortingFn: "alphanumeric",
				header: ({ column }) => <HeaderButton column={column} name={t`Message`} Icon={MessageSquareTextIcon} />,
				cell: ({ row }) => (
					<span className="block truncate text-muted-foreground" title={row.original.message}>
						{row.original.message || "-"}
					</span>
				),
			},
		]
		return sensorId ? columns.filter((column) => column.id !== "sensor") : columns
	}, [sensors, checks, now, sensorId])

	const table = useReactTable({
		data: records,
		columns,
		getRowId: (incident) => incident.id,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		onSortingChange: setSorting,
		onColumnVisibilityChange,
		onGlobalFilterChange: setSearch,
		globalFilterFn: (row, _columnId, value: string) => {
			const incident = row.original
			const text = [
				sensors[incident.sensor]?.name,
				checks[incident.check] ? checkName(checks[incident.check]) : "",
				incident.code || "",
				incident.message,
			]
				.join(" ")
				.toLowerCase()
			return value
				.toLowerCase()
				.split(" ")
				.every((term) => text.includes(term))
		},
		state: { sorting, columnVisibility, globalFilter: search },
	})

	const rows = table.getRowModel().rows
	const incidentCount = rows.length
	const totalDuration = formatMs(rows.reduce((sum, row) => sum + incidentDuration(row.original, now), 0))

	return (
		<Card className="@container w-full px-3 py-5 sm:py-6 sm:px-6">
			<CardHeader className="p-0 mb-3 sm:mb-4">
				<div className="grid md:flex gap-x-5 gap-y-3 w-full items-end">
					<div className="px-2 sm:px-1">
						<CardTitle className="mb-2">
							<Trans>Latest interruptions</Trans>
						</CardTitle>
						<div className="text-sm text-muted-foreground flex items-center flex-wrap">
							<Trans>Interruptions: {incidentCount}</Trans>
							<Separator orientation="vertical" className="h-4 mx-2 bg-primary/40" />
							<Trans>Total duration: {totalDuration}</Trans>
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-x-3 gap-y-2 md:ms-auto">
						<PeriodSelect
							id={`incidents-${sensorId ?? "all"}`}
							period={period}
							from={from}
							to={to}
							onPeriodChange={setPeriod}
							onFromChange={setFrom}
							onToChange={setTo}
						/>
						{!sensorId && <SensorsSelect value={sensorsFilter} onChange={setSensorsFilter} />}
						<div className="relative">
							<Input
								placeholder={t`Filter...`}
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								className="ps-4 pe-10 w-full md:w-48"
							/>
							{search && (
								<Button
									type="button"
									variant="ghost"
									size="icon"
									aria-label={t`Clear`}
									className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground"
									onClick={() => setSearch("")}
								>
									<XIcon className="h-4 w-4" />
								</Button>
							)}
						</div>
						<ColumnsViewMenu table={table} />
					</div>
				</div>
			</CardHeader>
			<div className="h-min max-h-[calc(100dvh-17rem)] max-w-full relative overflow-auto border rounded-md">
				<table className="text-sm w-full text-nowrap">
					<TableHeader className="sticky top-0 z-50 w-full border-b-2">
						{table.getHeaderGroups().map((headerGroup) => (
							<tr key={headerGroup.id}>
								{headerGroup.headers.map((header) => (
									<TableHead
										key={header.id}
										className="px-2 relative"
										style={headerWidthStyle(widths[header.column.id])}
									>
										{flexRender(header.column.columnDef.header, header.getContext())}
										<ColumnResizer columnId={header.column.id} onColumnResize={onColumnResize} />
									</TableHead>
								))}
							</tr>
						))}
					</TableHeader>
					<TableBody>
						{rows.length ? (
							rows.map((row) => (
								<TableRow key={row.id} className={cn(!row.original.end && "bg-red-500/5")}>
									{row.getVisibleCells().map((cell) => (
										<TableCell
											key={cell.id}
											className="py-2.5 ps-4.5"
											style={cellWidthStyle(widths[cell.column.id], cell.column.columnDef.meta?.grow)}
											{...resizedAttr(widths[cell.column.id], cell.column.columnDef.meta?.grow)}
										>
											{flexRender(cell.column.columnDef.cell, cell.getContext())}
										</TableCell>
									))}
								</TableRow>
							))
						) : (
							<TableRow>
								<TableCell colSpan={table.getVisibleLeafColumns().length} className="h-24 text-center">
									{loading ? (
										<LoaderCircleIcon className="size-4 animate-spin mx-auto text-muted-foreground" />
									) : (
										<Trans>No interruptions over this period.</Trans>
									)}
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</table>
			</div>
		</Card>
	)
}

function HeaderButton({
	column,
	name,
	Icon,
}: {
	column: Column<SensorIncidentRecord>
	name: string
	Icon: React.ElementType
}) {
	const isSorted = column.getIsSorted()
	return (
		<Button
			className={cn(
				"h-9 px-3 flex items-center gap-2 duration-50",
				isSorted && "bg-accent/70 light:bg-accent text-accent-foreground/90"
			)}
			variant="ghost"
			onClick={() => column.toggleSorting(isSorted === "asc")}
		>
			<Icon className="size-4" />
			{name}
			<ArrowUpDownIcon className="size-4" />
		</Button>
	)
}

/** Choice of one or several sensors; an empty selection means all sensors */
function SensorsSelect({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
	const sensors = useStore($sensors)
	const list = Object.values(sensors).sort((a, b) => a.name.localeCompare(b.name))
	const selected = new Set(value)
	const count = value.length
	const firstName = sensors[value[0] ?? ""]?.name
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" className="justify-between gap-2 font-normal min-w-48 max-w-72">
					<span className="flex items-center gap-2 min-w-0">
						<NetworkIcon className="size-4 shrink-0 opacity-70" />
						<span className="truncate">
							{count === 0 ? (
								<Trans>All sensors</Trans>
							) : count === 1 && firstName ? (
								firstName
							) : (
								<Plural value={count} one="# sensor" other="# sensors" />
							)}
						</span>
					</span>
					<ChevronDownIcon className="size-4 shrink-0 opacity-50" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="max-h-80 overflow-y-auto min-w-52">
				<DropdownMenuCheckboxItem
					checked={count === 0}
					onSelect={(e) => e.preventDefault()}
					onCheckedChange={() => onChange([])}
				>
					<Trans>All sensors</Trans>
				</DropdownMenuCheckboxItem>
				<DropdownMenuSeparator />
				{list.map((sensor) => (
					<DropdownMenuCheckboxItem
						key={sensor.id}
						checked={selected.has(sensor.id)}
						onSelect={(e) => e.preventDefault()}
						onCheckedChange={(checked) => {
							const next = new Set(selected)
							checked ? next.add(sensor.id) : next.delete(sensor.id)
							onChange([...next])
						}}
					>
						{sensor.name}
					</DropdownMenuCheckboxItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
