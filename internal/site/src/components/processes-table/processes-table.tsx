import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import {
	type RowSelectionState,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getSortedRowModel,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
	ArrowDownToLineIcon,
	ArrowUpFromLineIcon,
	CpuIcon,
	LoaderCircleIcon,
	MemoryStickIcon,
	NetworkIcon,
	PauseIcon,
	PlayIcon,
	RefreshCwIcon,
	WaypointsIcon,
	XIcon,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
	cellWidthStyle,
	ColumnResizer,
	ColumnsViewMenu,
	headerWidthStyle,
	useTableLayout,
} from "@/components/table-layout"
import { BulkQuietHoursButton } from "@/components/alerts/bulk-quiet-hours"
import { BulkStateAlertsButton, selectionColumn } from "@/components/alerts/bulk-state-alerts"
import { type ImportantTile, ImportantTargets } from "@/components/important-targets"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { isReadOnlyUser, pb } from "@/lib/api"
import { $openRequest, isRequested } from "@/lib/recent"
import { $stateAlerts, importantTargets } from "@/lib/state-alerts"
import { cn } from "@/lib/utils"
import {
	formatRate,
	formatSize,
	percent,
	ProcessDialog,
	type ProcessRow,
	processKey,
	usageClass,
} from "./process-dialog"
import { useProcessColumns } from "./process-columns"
import { processesHistory, ProcessesCharts, recordProcesses } from "./processes-charts"

/** Refresh of the list while the page is shown */
/** Columns hidden until the user shows them */
const hiddenByDefault = ["command"]

const refreshEvery = 15_000

/** Reads the processes of a host */
async function fetchProcesses(system: string) {
	try {
		const res = await pb.send<{ processes: Omit<ProcessRow, "system">[] }>("/api/beszel/processes", {
			query: { system },
			requestKey: null,
		})
		return { rows: res.processes.map((process) => ({ ...process, system })), outdated: false, failed: false }
	} catch (err) {
		const outdated = /^outdated/i.test((err as Error).message)
		return { rows: [] as ProcessRow[], outdated, failed: !outdated }
	}
}

/**
 * Processes of a host: use of the CPU, memory, disk and network by each
 * process, read from its agent, with charts of the top consumers.
 */
export default function ProcessesTable({ systemId }: { systemId: string }) {
	const [rows, setRows] = useState<ProcessRow[]>()
	const [history, setHistory] = useState(() => processesHistory(systemId))
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState({ outdated: false, failed: false })
	const [auto, setAuto] = useState(true)
	const [filter, setFilter] = useState("")
	const [sorting, setSorting] = useState<SortingState>([{ id: "cpu", desc: true }])
	const [selected, setSelected] = useState<ProcessRow | null>(null)
	const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
	const layout = useTableLayout("system-processes", hiddenByDefault)
	const baseColumns = useProcessColumns()
	const columns = useMemo(
		() => (isReadOnlyUser() ? baseColumns : [selectionColumn<ProcessRow>(), ...baseColumns]),
		[baseColumns]
	)

	// the latest reading, so that a slower previous one does not replace it
	const lastLoad = useRef(0)
	const load = useCallback(async () => {
		if (document.hidden) {
			return
		}
		const id = ++lastLoad.current
		setLoading(true)
		const result = await fetchProcesses(systemId)
		if (id !== lastLoad.current) {
			return
		}
		setRows(result.rows)
		if (result.rows.length) {
			setHistory(recordProcesses(systemId, result.rows))
		}
		setError({ outdated: result.outdated, failed: result.failed })
		setLoading(false)
	}, [systemId])

	useEffect(() => {
		load()
		if (!auto) {
			return
		}
		// the readings are skipped while the page is hidden: read again when it shows
		const onVisible = () => !document.hidden && load()
		document.addEventListener("visibilitychange", onVisible)
		const timer = setInterval(load, refreshEvery)
		return () => {
			clearInterval(timer)
			document.removeEventListener("visibilitychange", onVisible)
		}
	}, [load, auto])

	// a process of an active alert opens once the processes are read
	const openRequest = useStore($openRequest)
	useEffect(() => {
		const process = rows?.find((row) => isRequested(openRequest, "process", row))
		if (process) {
			$openRequest.set(null)
			setSelected(process)
		}
	}, [openRequest, rows])

	// a process of the charts opens with its last reading, or its values in the chart once it ended
	const selectPoint = useCallback(
		(point: { pid: number; started?: number; name: string; cpu: number; mem: number }) => {
			const key = processKey(point)
			const row = rows?.find((process) => processKey(process) === key)
			setSelected(row ?? { ...point, system: systemId })
		},
		[rows, systemId]
	)

	const table = useReactTable({
		data: rows ?? [],
		columns,
		// the instances of a program are selected one by one, the rules target the program
		getRowId: (row) => processKey(row),
		onRowSelectionChange: setRowSelection,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		onSortingChange: setSorting,
		onColumnVisibilityChange: layout.onColumnVisibilityChange,
		onGlobalFilterChange: setFilter,
		globalFilterFn: (row, _columnId, value: string) => {
			const text =
				`${row.original.name} ${row.original.pid} ${row.original.user ?? ""} ${row.original.command ?? ""}`.toLowerCase()
			return value
				.toLowerCase()
				.split(" ")
				.filter(Boolean)
				.every((term) => text.includes(term))
		},
		state: {
			sorting,
			columnVisibility: layout.columnVisibility,
			globalFilter: filter,
			rowSelection,
		},
	})
	const tableRows = table.getRowModel().rows
	const selectedItems = table.getFilteredSelectedRowModel().rows.map((row) => row.original)

	// programs targeted by a process rule: their instances added up, or stopped
	const stateAlerts = useStore($stateAlerts)
	const importantTiles = useMemo((): ImportantTile[] => {
		const programs = new Map<string, { name: string; system: string; cpu: number; count: number; first: ProcessRow }>()
		for (const row of rows ?? []) {
			const program = programs.get(row.name)
			if (program) {
				program.cpu += row.cpu ?? 0
				program.count++
			} else {
				programs.set(row.name, { name: row.name, system: systemId, cpu: row.cpu ?? 0, count: 1, first: row })
			}
		}
		if (!rows) {
			return []
		}
		return importantTargets(stateAlerts, "process", [...programs.values()], systemId).map(
			({ item, name, system, triggered }) => {
				const count = item?.count ?? 0
				const cpuText = percent(item?.cpu)
				return {
					key: `${system}/${name}`,
					name,
					dotClass: item ? (triggered ? "bg-red-500" : "bg-green-500") : "bg-zinc-400",
					status: item ? (
						<Trans>
							{count} instance(s) · CPU {cpuText}
						</Trans>
					) : (
						t`Stopped`
					),
					triggered,
					onClick: item ? () => setSelected(item.first) : undefined,
					target: { kind: "process", system },
				}
			}
		)
	}, [stateAlerts, rows, systemId])

	const scrollRef = useRef<HTMLDivElement>(null)
	const virtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
		count: tableRows.length,
		estimateSize: () => 41,
		getScrollElement: () => scrollRef.current,
		overscan: 8,
	})
	const virtualRows = virtualizer.getVirtualItems()
	const paddingTop = Math.max(0, virtualRows[0]?.start ?? 0)
	const paddingBottom = Math.max(0, virtualizer.getTotalSize() - (virtualRows[virtualRows.length - 1]?.end ?? 0))
	// use of the host by all its processes
	const hostTotals = useMemo(() => sumProcesses(rows ?? []), [rows])
	const cpuText = percent(hostTotals.cpu)
	const memText = percent(hostTotals.mem)
	const diskText = `↓ ${formatRate(hostTotals.dr)} · ↑ ${formatRate(hostTotals.dw)}`
	// totals of the processes shown, following the filter
	const filteredRows = table.getFilteredRowModel().rows
	const shownTotals = useMemo(() => sumProcesses(filteredRows.map((row) => row.original)), [filteredRows])
	const totalCount = tableRows.length

	return (
		<Card className="@container w-full px-3 py-5 sm:py-6 sm:px-6">
			<CardHeader className="p-0 mb-3 sm:mb-4">
				<div className="grid md:flex gap-x-5 gap-y-3 w-full items-end">
					<div className="px-2 sm:px-1">
						<CardTitle className="mb-2">
							<Trans>Processes</Trans>
						</CardTitle>
						<div className="text-sm text-muted-foreground flex items-center flex-wrap">
							<Trans>Total: {totalCount}</Trans>
							{rows && !error.outdated && !error.failed && (
								<>
									<Separator orientation="vertical" className="h-4 mx-2 bg-primary/40" />
									<Trans>CPU: {cpuText}</Trans>
									<Separator orientation="vertical" className="h-4 mx-2 bg-primary/40" />
									<Trans>Memory: {memText}</Trans>
									<Separator orientation="vertical" className="h-4 mx-2 bg-primary/40" />
									<Trans>Disk: {diskText}</Trans>
								</>
							)}
							{(error.outdated || error.failed) && (
								<>
									<Separator orientation="vertical" className="h-4 mx-2 bg-primary/40" />
									<span className="text-destructive">
										{error.outdated ? (
											<Trans>The agent of this system needs an update (0.20.0-fork.5 or newer).</Trans>
										) : (
											<Trans>The processes could not be read.</Trans>
										)}
									</span>
								</>
							)}
						</div>
					</div>
					<div className="flex flex-wrap gap-2 ms-auto w-full md:w-auto">
						<div className="relative flex-1 md:w-56">
							<Input
								placeholder={t`Filter...`}
								value={filter}
								onChange={(e) => setFilter(e.target.value)}
								className="ps-4 pe-10 w-full"
							/>
							{filter && (
								<Button
									type="button"
									variant="ghost"
									size="icon"
									aria-label={t`Clear`}
									className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground"
									onClick={() => setFilter("")}
								>
									<XIcon className="h-4 w-4" />
								</Button>
							)}
						</div>
						<ColumnsViewMenu table={table} />
						<BulkStateAlertsButton kind="process" items={selectedItems} />
						<BulkQuietHoursButton kind="process" items={selectedItems} />
						<Button
							variant="outline"
							size="icon"
							onClick={() => setAuto(!auto)}
							aria-label={auto ? t`Pause the refresh` : t`Refresh automatically`}
							title={auto ? t`Pause the refresh` : t`Refresh automatically`}
						>
							{auto ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
						</Button>
						<Button variant="outline" size="icon" onClick={load} disabled={loading} aria-label={t`Refresh`}>
							{loading ? <LoaderCircleIcon className="size-4 animate-spin" /> : <RefreshCwIcon className="size-4" />}
						</Button>
					</div>
				</div>
			</CardHeader>
			<ImportantTargets title={<Trans>Important processes</Trans>} tiles={importantTiles} />
			{!error.outdated && <ProcessesCharts history={history} onSelect={selectPoint} />}
			<div
				ref={scrollRef}
				className={cn(
					"h-min max-h-[calc(100dvh-17rem)] max-w-full relative overflow-auto border rounded-md",
					rows?.length && "rounded-b-none",
					(!tableRows.length || tableRows.length > 2) && "min-h-50"
				)}
			>
				<div style={{ height: `${virtualizer.getTotalSize() + 48}px`, paddingTop, paddingBottom }}>
					<table className="text-sm w-full text-nowrap">
						<TableHeader className="sticky top-0 z-50 w-full border-b-2">
							{table.getHeaderGroups().map((group) => (
								<tr key={group.id}>
									{group.headers.map((header) => (
										<TableHead
											key={header.id}
											className="px-2 relative"
											style={headerWidthStyle(layout.widths[header.column.id])}
										>
											{flexRender(header.column.columnDef.header, header.getContext())}
											<ColumnResizer columnId={header.column.id} onColumnResize={layout.onColumnResize} />
										</TableHead>
									))}
								</tr>
							))}
						</TableHeader>
						<TableBody>
							{tableRows.length ? (
								virtualRows.map((virtualRow) => {
									const row = tableRows[virtualRow.index]
									return (
										<TableRow key={row.id} className="cursor-pointer" onClick={() => setSelected(row.original)}>
											{row.getVisibleCells().map((cell) => (
												<TableCell
													key={cell.id}
													className="py-2 ps-4.5"
													style={{
														height: virtualRow.size,
														...cellWidthStyle(layout.widths[cell.column.id], cell.column.columnDef.meta?.grow),
													}}
												>
													{flexRender(cell.column.columnDef.cell, cell.getContext())}
												</TableCell>
											))}
										</TableRow>
									)
								})
							) : (
								<TableRow>
									<TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
										{rows === undefined ? (
											<LoaderCircleIcon className="size-5 animate-spin mx-auto" />
										) : (
											<Trans>No processes found.</Trans>
										)}
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</table>
				</div>
			</div>
			{!!rows?.length && <ProcessTotals totals={shownTotals} filtered={!!filter} />}
			<Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
				{selected && <ProcessDialog process={selected} />}
			</Dialog>
		</Card>
	)
}

/** Use of the resources added up over processes */
interface ProcessTotals {
	count: number
	cpu: number
	mem: number
	rss: number
	dr: number
	dw: number
	conns: number
	threads: number
}

function sumProcesses(processes: ProcessRow[]): ProcessTotals {
	const totals: ProcessTotals = { count: 0, cpu: 0, mem: 0, rss: 0, dr: 0, dw: 0, conns: 0, threads: 0 }
	for (const process of processes) {
		totals.count++
		totals.cpu += process.cpu ?? 0
		totals.mem += process.mem ?? 0
		totals.rss += process.rss ?? 0
		totals.dr += process.dr ?? 0
		totals.dw += process.dw ?? 0
		totals.conns += process.conns ?? 0
		totals.threads += process.threads ?? 0
	}
	return totals
}

/** Bar under the table: the totals of the processes shown, which follow the filter */
function ProcessTotals({ totals, filtered }: { totals: ProcessTotals; filtered: boolean }) {
	const count = totals.count
	const items: [React.ElementType, React.ReactNode, React.ReactNode][] = [
		[CpuIcon, t`CPU`, <span className={usageClass(totals.cpu)}>{percent(totals.cpu)}</span>],
		[
			MemoryStickIcon,
			t`Memory`,
			<>
				<span className={usageClass(totals.mem)}>{percent(totals.mem)}</span>
				<span className="ms-1 text-muted-foreground">{formatSize(totals.rss)}</span>
			</>,
		],
		[ArrowDownToLineIcon, t`Disk read`, formatRate(totals.dr)],
		[ArrowUpFromLineIcon, t`Disk write`, formatRate(totals.dw)],
		[NetworkIcon, t`Connections`, totals.conns || "-"],
		[WaypointsIcon, t`Threads`, totals.threads || "-"],
	]
	return (
		<div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-b-md border border-t-0 bg-muted/40 px-4 py-2.5 text-sm">
			<span className="font-medium me-auto">
				{filtered ? <Trans>Total of the filtered processes ({count})</Trans> : <Trans>Total ({count} processes)</Trans>}
			</span>
			{items.map(([Icon, label, value], index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: fixed list
				<span key={index} className="inline-flex items-center gap-1.5 tabular-nums" title={String(label)}>
					<Icon className="size-3.5 text-muted-foreground" />
					<span className="text-muted-foreground">{label}</span>
					<span className="font-medium">{value}</span>
				</span>
			))}
		</div>
	)
}
