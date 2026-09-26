import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
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
import { useVirtualizer } from "@tanstack/react-virtual"
import {
	ActivityIcon,
	ArrowDownToLineIcon,
	ArrowUpDownIcon,
	ArrowUpFromLineIcon,
	CalendarClockIcon,
	CpuIcon,
	HashIcon,
	LoaderCircleIcon,
	MemoryStickIcon,
	NetworkIcon,
	PauseIcon,
	PlayIcon,
	RefreshCwIcon,
	SquareTerminalIcon,
	UserIcon,
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
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { pb } from "@/lib/api"
import { formatDateTime } from "@/lib/time"
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
import { processesHistory, ProcessesCharts, recordProcesses } from "./processes-charts"

/** Refresh of the list while the page is shown */
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

/** Header of a sortable column: icon, name and sort arrow, like the other tables */
function HeaderButton({ column, name, Icon }: { column: Column<ProcessRow>; name: string; Icon: React.ElementType }) {
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

/** Numbers sort from the largest first on their first click */
const numeric = (accessor: (row: ProcessRow) => number | undefined) => ({
	accessorFn: (row: ProcessRow) => accessor(row) ?? 0,
	sortDescFirst: true,
})

function useColumns(): ColumnDef<ProcessRow>[] {
	return useMemo(() => {
		const columns: ColumnDef<ProcessRow>[] = [
			{
				id: "name",
				meta: { name: () => t`Name` },
				accessorFn: (row) => row.name,
				enableHiding: false,
				header: ({ column }) => <HeaderButton column={column} name={t`Name`} Icon={SquareTerminalIcon} />,
				cell: ({ row }) => (
					<span
						className="ms-1.5 block max-w-64 truncate font-medium"
						title={row.original.command || row.original.name}
					>
						{row.original.name}
					</span>
				),
			},
			{
				id: "pid",
				meta: { name: () => "PID" },
				...numeric((row) => row.pid),
				sortDescFirst: false,
				header: ({ column }) => <HeaderButton column={column} name="PID" Icon={HashIcon} />,
				cell: ({ getValue }) => <span className="ms-1.5 tabular-nums">{getValue() as number}</span>,
			},
			{
				id: "user",
				meta: { name: () => t`User` },
				accessorFn: (row) => row.user ?? "",
				header: ({ column }) => <HeaderButton column={column} name={t`User`} Icon={UserIcon} />,
				cell: ({ getValue }) => (
					<span className="ms-1.5 block max-w-40 truncate text-muted-foreground">{(getValue() as string) || "-"}</span>
				),
			},
			{
				id: "cpu",
				meta: { name: () => t`CPU` },
				...numeric((row) => row.cpu),
				header: ({ column }) => <HeaderButton column={column} name={t`CPU`} Icon={CpuIcon} />,
				cell: ({ row }) => <span className={cn("ms-1.5 tabular-nums", usageClass(row.original.cpu))}>{percent(row.original.cpu)}</span>,
			},
			{
				id: "mem",
				meta: { name: () => t`Memory` },
				...numeric((row) => row.mem),
				header: ({ column }) => <HeaderButton column={column} name={t`Memory`} Icon={MemoryStickIcon} />,
				cell: ({ row }) => (
					<span className="ms-1.5 tabular-nums">
						<span className={usageClass(row.original.mem)}>{percent(row.original.mem)}</span>
						<span className="ms-1.5 text-xs text-muted-foreground">{formatSize(row.original.rss)}</span>
					</span>
				),
			},
			{
				id: "dr",
				meta: { name: () => t`Disk read` },
				...numeric((row) => row.dr),
				header: ({ column }) => <HeaderButton column={column} name={t`Disk read`} Icon={ArrowDownToLineIcon} />,
				cell: ({ row }) => <span className="ms-1.5 tabular-nums">{formatRate(row.original.dr)}</span>,
			},
			{
				id: "dw",
				meta: { name: () => t`Disk write` },
				...numeric((row) => row.dw),
				header: ({ column }) => <HeaderButton column={column} name={t`Disk write`} Icon={ArrowUpFromLineIcon} />,
				cell: ({ row }) => <span className="ms-1.5 tabular-nums">{formatRate(row.original.dw)}</span>,
			},
			{
				id: "conns",
				meta: { name: () => t`Network connections` },
				...numeric((row) => row.conns),
				header: ({ column }) => <HeaderButton column={column} name={t`Connections`} Icon={NetworkIcon} />,
				cell: ({ row }) => <span className="ms-1.5 tabular-nums">{row.original.conns || "-"}</span>,
			},
			{
				id: "threads",
				meta: { name: () => t`Threads` },
				...numeric((row) => row.threads),
				header: ({ column }) => <HeaderButton column={column} name={t`Threads`} Icon={WaypointsIcon} />,
				cell: ({ row }) => <span className="ms-1.5 tabular-nums">{row.original.threads || "-"}</span>,
			},
			{
				id: "started",
				meta: { name: () => t`Started` },
				...numeric((row) => row.started),
				header: ({ column }) => <HeaderButton column={column} name={t`Started`} Icon={CalendarClockIcon} />,
				cell: ({ row }) => (
					<span className="ms-1.5 tabular-nums text-muted-foreground">
						{row.original.started ? formatDateTime(row.original.started * 1000) : "-"}
					</span>
				),
			},
			{
				id: "status",
				meta: { name: () => t`Status` },
				accessorFn: (row) => row.status ?? "",
				header: ({ column }) => <HeaderButton column={column} name={t`Status`} Icon={ActivityIcon} />,
				cell: ({ getValue }) => <span className="ms-1.5 text-muted-foreground">{(getValue() as string) || "-"}</span>,
			},
			{
				id: "command",
				meta: { name: () => t`Command`, grow: true },
				accessorFn: (row) => row.command ?? "",
				header: ({ column }) => <HeaderButton column={column} name={t`Command`} Icon={SquareTerminalIcon} />,
				cell: ({ getValue }) => (
					<span
						className="ms-1.5 block max-w-md truncate font-mono text-xs text-muted-foreground"
						title={getValue() as string}
					>
						{getValue() as string}
					</span>
				),
			},
		]
		return columns
	}, [])
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
	const layout = useTableLayout("system-processes")
	const columns = useColumns()

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
		state: { sorting, columnVisibility: { command: false, ...layout.columnVisibility }, globalFilter: filter },
	})
	const tableRows = table.getRowModel().rows

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
	const totalCpu = (rows ?? []).reduce((sum, row) => sum + (row.cpu ?? 0), 0)
	const totalCount = tableRows.length
	const cpuText = percent(totalCpu)

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
			{!error.outdated && <ProcessesCharts history={history} onSelect={selectPoint} />}
			<div
				ref={scrollRef}
				className={cn(
					"h-min max-h-[calc(100dvh-17rem)] max-w-full relative overflow-auto border rounded-md",
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
			<Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
				{selected && <ProcessDialog process={selected} />}
			</Dialog>
		</Card>
	)
}
