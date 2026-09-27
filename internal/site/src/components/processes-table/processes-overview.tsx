import { t } from "@lingui/core/macro"
import { Plural, Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { getPagePath } from "@nanostores/router"
import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getSortedRowModel,
	type RowSelectionState,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table"
import {
	ArrowRightIcon,
	BoxesIcon,
	ChevronDownIcon,
	CpuIcon,
	FlameIcon,
	LayersIcon,
	ListTreeIcon,
	LoaderCircleIcon,
	MemoryStickIcon,
	MonitorCogIcon,
	RefreshCwIcon,
	SearchIcon,
	ServerIcon,
	XIcon,
} from "lucide-react"
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react"
import { BulkStateAlertsButton, selectionColumn } from "@/components/alerts/bulk-state-alerts"
import { $router, Link } from "@/components/router"
import {
	cellWidthStyle,
	ColumnResizer,
	ColumnsViewMenu,
	headerWidthStyle,
	resizedAttr,
	useTableLayout,
} from "@/components/table-layout"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { isReadOnlyUser, pb } from "@/lib/api"
import { useSystemBrands } from "@/lib/os-brands"
import { $processSearch } from "@/lib/fleet-programs"
import { $allSystemsById, $systems } from "@/lib/stores"
import { systemGroup } from "@/lib/system-groups"
import { cn } from "@/lib/utils"
import { HeaderButton, useProcessColumns } from "./process-columns"
import { formatSize, percent, ProcessDialog, type ProcessRow, usageClass } from "./process-dialog"

/** The instances of a program on a host, added up by the hub */
interface Program {
	name: string
	count: number
	cpu: number
	mem: number
	rss: number
}

/** Processes of a host, summed up by the hub */
interface ProcessesOverview {
	system: string
	error?: string
	count: number
	threads: number
	cpu: number
	mem: number
	topCpu: ProcessRow[]
	topMem: ProcessRow[]
	programs: Program[]
	recent: ProcessRow[]
	recentCount: number
	matches: ProcessRow[]
}

type RawOverview = Omit<ProcessesOverview, "topCpu" | "topMem" | "recent" | "matches" | "programs" | "recentCount"> & {
	topCpu?: Omit<ProcessRow, "system">[]
	topMem?: Omit<ProcessRow, "system">[]
	recent?: Omit<ProcessRow, "system">[]
	matches?: Omit<ProcessRow, "system">[]
	programs?: Program[]
	recentCount?: number
}

/** Processes kept for each host in the top consumers */
const topCount = 10

/** Hosts shown by the top consumers until the user filters or asks for more */
const defaultTopHosts = 3
/** The processes started in the last day are the recent ones */
const recentWindow = 24 * 3600
/** Share of the host from which it counts as loaded */
const loadedHost = 50
/** Height of the tables of the page: 20 rows, then they scroll */
const tableHeight = "max-h-[calc(20*2.5625rem+3rem)]"

/** Asks the hub for the processes of the hosts: it reads the agents and keeps what the page needs */
async function fetchOverview(
	systems: string[],
	params: { top?: number; q?: string; programs?: number; recent?: number }
): Promise<ProcessesOverview[]> {
	const res = await pb.send<{ systems: RawOverview[] }>("/api/beszel/processes/overview", {
		query: { systems: systems.join(","), ...params },
		requestKey: null,
	})
	const withSystem = (system: string, list?: Omit<ProcessRow, "system">[]) =>
		(list ?? []).map((process) => ({ ...process, system }))
	return res.systems.map((overview) => ({
		...overview,
		topCpu: withSystem(overview.system, overview.topCpu),
		topMem: withSystem(overview.system, overview.topMem),
		recent: withSystem(overview.system, overview.recent),
		matches: withSystem(overview.system, overview.matches),
		programs: overview.programs ?? [],
		recentCount: overview.recentCount ?? 0,
	}))
}

/** IDs of the systems that are up, the ones whose agent can answer */
function useUpSystems() {
	const systems = useStore($systems)
	const key = systems
		.filter((system) => system.status === "up")
		.map((system) => system.id)
		.sort()
		.join()
	return useMemo(() => (key ? key.split(",") : []), [key])
}

const systemPath = (id: string) => getPagePath($router, "system", { id })

function SystemLink({ id, className }: { id: string; className?: string }) {
	const systems = useStore($allSystemsById)
	return (
		<Link
			href={systemPath(id)}
			className={cn("font-medium hover:underline underline-offset-2 truncate", className)}
			onClick={(e) => e.stopPropagation()}
		>
			{systems[id]?.name ?? id}
		</Link>
	)
}

/** Hosts that could not answer: agents too old, or errors */
function Unanswered({ overviews }: { overviews: ProcessesOverview[] }) {
	const outdated = overviews.filter((overview) => overview.error === "outdated").length
	const failed = overviews.filter((overview) => overview.error && overview.error !== "outdated").length
	if (!outdated && !failed) {
		return null
	}
	return (
		<p className="text-sm text-muted-foreground mt-3">
			{outdated > 0 && <Trans>{outdated} system(s) need an agent update (0.20.0-fork.5 or newer).</Trans>}{" "}
			{failed > 0 && <Trans>{failed} system(s) did not answer.</Trans>}
		</p>
	)
}

/** Title of a block of the page */
function BlockHeader({ title, description }: { title: ReactNode; description: ReactNode }) {
	return (
		<CardHeader className="p-0 mb-4 px-2 sm:px-1">
			<CardTitle className="mb-1.5">{title}</CardTitle>
			<CardDescription>{description}</CardDescription>
		</CardHeader>
	)
}

/** Reads the processes of the fleet again: the last button of the toolbar of each block */
function RefreshButton({ onRefresh, loading }: { onRefresh: () => void; loading: boolean }) {
	return (
		<Button
			variant="outline"
			size="icon"
			className="shrink-0"
			onClick={onRefresh}
			disabled={loading}
			aria-label={t`Refresh`}
			title={t`Refresh`}
		>
			{loading ? <LoaderCircleIcon className="size-4 animate-spin" /> : <RefreshCwIcon className="size-4" />}
		</Button>
	)
}

/**
 * Choice of some hosts among a list, none chosen meaning all of them, and of
 * the brand of their OS when brands are given: both in one dropdown.
 */
function SystemsFilter({
	systems,
	selected,
	onChange,
	brands,
	brand = "",
	onBrandChange,
}: {
	systems: string[]
	selected: string[]
	onChange: (selected: string[]) => void
	/** brand of the OS of each system */
	brands?: Record<string, string>
	brand?: string
	onBrandChange?: (brand: string) => void
}) {
	const names = useStore($allSystemsById)
	const brandList = brands ? [...new Set(systems.map((id) => brands[id]))].sort() : []
	const sorted = [...systems]
		.filter((id) => !brand || brands?.[id] === brand)
		.sort((a, b) => (names[a]?.name ?? a).localeCompare(names[b]?.name ?? b))
	const count = selected.length
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" className="shrink-0 gap-1.5">
					<ServerIcon className="size-4 opacity-80" />
					{brand && <span>{brand}</span>}
					{brand && count > 0 && <span className="text-muted-foreground">·</span>}
					{count ? <Trans>Systems ({count})</Trans> : !brand && <Trans>All Systems</Trans>}
					<ChevronDownIcon className="size-4 opacity-50" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-52 max-h-96 overflow-y-auto">
				{brandList.length > 1 && onBrandChange && (
					<>
						<DropdownMenuLabel className="flex items-center gap-2">
							<MonitorCogIcon className="size-4" />
							<Trans>Operating system</Trans>
						</DropdownMenuLabel>
						<DropdownMenuRadioGroup value={brand || "all"} onValueChange={(value) => onBrandChange(value === "all" ? "" : value)}>
							<DropdownMenuRadioItem value="all" onSelect={(e) => e.preventDefault()}>
								<Trans>All OS</Trans>
							</DropdownMenuRadioItem>
							{brandList.map((value) => (
								<DropdownMenuRadioItem key={value} value={value} onSelect={(e) => e.preventDefault()}>
									{value}
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
						<DropdownMenuSeparator />
					</>
				)}
				<DropdownMenuLabel className="flex items-center gap-2">
					<ServerIcon className="size-4" />
					<Trans>Systems</Trans>
				</DropdownMenuLabel>
				<DropdownMenuItem disabled={!count} onSelect={() => onChange([])}>
					<Trans>All Systems</Trans>
				</DropdownMenuItem>
				{sorted.map((id) => (
					<DropdownMenuCheckboxItem
						key={id}
						checked={selected.includes(id)}
						onSelect={(e) => e.preventDefault()}
						onCheckedChange={(checked) =>
							onChange(checked ? [...selected, id] : selected.filter((other) => other !== id))
						}
					>
						{names[id]?.name ?? id}
					</DropdownMenuCheckboxItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

/** Filters of the hosts shared by the blocks: their group, the brand of their OS and some of them */
function useHostFilters(systems: string[]) {
	const allSystems = useStore($allSystemsById)
	const records = useMemo(() => systems.map((id) => allSystems[id]).filter(Boolean), [systems, allSystems])
	const brands = useSystemBrands(records)
	const [shownSystems, setShownSystems] = useState<string[]>([])
	const [brand, setBrand] = useState("")
	const [group, setGroup] = useState("")
	const groupList = useMemo(() => [...new Set(records.map(systemGroup).filter(Boolean))].sort(), [records])
	const brandKey = JSON.stringify(brands)
	const keeps = useCallback(
		(id: string) => {
			const system = allSystems[id]
			return (
				(!shownSystems.length || shownSystems.includes(id)) &&
				(!brand || brands[id] === brand) &&
				(!group || (!!system && systemGroup(system) === group))
			)
		},
		// brands is a new object on each render
		[allSystems, shownSystems, brand, group, brandKey]
	)
	return {
		systems,
		brands,
		shownSystems,
		setShownSystems,
		brand,
		setBrand,
		group,
		setGroup,
		groupList,
		keeps,
		/** true when the user narrowed the hosts */
		narrowed: shownSystems.length > 0 || !!brand || !!group,
	}
}

/** Group dropdown and systems/OS dropdown of the filters of the hosts */
function HostFilters({ filters }: { filters: ReturnType<typeof useHostFilters> }) {
	const { groupList, group, setGroup } = filters
	return (
		<>
			{groupList.length > 0 && (
				<Select value={group || "all"} onValueChange={(value) => setGroup(value === "all" ? "" : value)}>
					<SelectTrigger className="w-auto min-w-36 gap-2">
						<LayersIcon className="size-4 shrink-0 opacity-70" />
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">
							<Trans>All groups</Trans>
						</SelectItem>
						{groupList.map((name) => (
							<SelectItem key={name} value={name}>
								{name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			)}
			{filters.systems.length > 1 && (
				<SystemsFilter
					systems={filters.systems}
					selected={filters.shownSystems}
					onChange={filters.setShownSystems}
					brands={filters.brands}
					brand={filters.brand}
					onBrandChange={filters.setBrand}
				/>
			)}
		</>
	)
}

/**
 * Page of all the processes: a search on demand, then the analysis of the
 * fleet read once from the hub (top consumers, programs, recent starts,
 * comparison), so that it stays light with many systems.
 */
export default function ProcessesOverviewPage() {
	const systems = useUpSystems()
	const [selected, setSelected] = useState<ProcessRow | null>(null)
	const [searchRequest, setSearchRequest] = useState<{ q: string; n: number }>()
	const [loading, setLoading] = useState(false)
	const [overviews, setOverviews] = useState<ProcessesOverview[]>()

	const load = useCallback(async () => {
		setLoading(true)
		try {
			setOverviews(await fetchOverview(systems, { top: topCount, programs: 1, recent: recentWindow }))
		} finally {
			setLoading(false)
		}
	}, [systems])

	// read once, when the systems are known; then on demand
	const [loaded, setLoaded] = useState(false)
	useEffect(() => {
		if (!loaded && systems.length) {
			setLoaded(true)
			load()
		}
	}, [systems, load, loaded])

	const search = useCallback((q: string) => {
		setSearchRequest((current) => ({ q, n: (current?.n ?? 0) + 1 }))
		document.getElementById("process-search")?.scrollIntoView({ behavior: "smooth", block: "start" })
	}, [])

	// a program chosen in the command palette, looked for once the systems are known
	const paletteSearch = useStore($processSearch)
	useEffect(() => {
		if (paletteSearch && systems.length) {
			$processSearch.set(null)
			search(paletteSearch)
		}
	}, [paletteSearch, systems, search])

	const answered = useMemo(() => (overviews ?? []).filter((overview) => !overview.error), [overviews])
	const refresh = <RefreshButton onRefresh={load} loading={loading} />
	const waiting = overviews === undefined && (
		<div className="h-24 grid place-items-center text-muted-foreground">
			{loading || systems.length ? <LoaderCircleIcon className="size-5 animate-spin" /> : <Trans>No systems are up.</Trans>}
		</div>
	)

	return (
		<>
			<div id="process-search" className="scroll-mt-20">
				<ProcessSearch systems={systems} request={searchRequest} onSelect={setSelected} />
			</div>
			<Card className="w-full px-3 py-5 sm:py-6 sm:px-6">
				<BlockHeader
					title={<Trans>Top consumers</Trans>}
					description={
						<Trans>The processes that use the most CPU and memory on each system that is up, at the time of the reading.</Trans>
					}
				/>
				{waiting || <TopConsumers overviews={answered} onSelect={setSelected} actions={refresh} />}
				{overviews && <Unanswered overviews={overviews} />}
			</Card>
			<Card className="w-full px-3 py-5 sm:py-6 sm:px-6">
				<BlockHeader
					title={<Trans>Programs of the fleet</Trans>}
					description={
						<Trans>Select programs to watch them on every system running them, or click one to find its processes.</Trans>
					}
				/>
				{waiting || <FleetPrograms overviews={answered} onSearch={search} actions={refresh} />}
			</Card>
			<Card className="w-full px-3 py-5 sm:py-6 sm:px-6">
				<BlockHeader
					title={<Trans>Recently started</Trans>}
					description={
						<Trans>
							Processes started in the last 24 hours, the newest first: new programs, restarts, or a program restarting in
							a loop.
						</Trans>
					}
				/>
				{waiting || <RecentStarts overviews={answered} onSelect={setSelected} actions={refresh} />}
			</Card>
			<Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
				{selected && <ProcessDialog process={selected} />}
			</Dialog>
		</>
	)
}

/* ------------------------------------------------------------------ */
/* Tables of processes of several systems                             */
/* ------------------------------------------------------------------ */

/** Rows shown at most in a table of processes, the filters find the others */
const maxRows = 500

/**
 * Processes of several systems, like the other tables: sortable columns with
 * icons, "View" menu, filter, choice of the systems, selection for the
 * alerts and quiet hours.
 */
function ProcessesGrid({
	rows,
	layoutKey,
	hiddenByDefault,
	initialSort,
	onSelect,
	emptyText,
	actions,
}: {
	rows: ProcessRow[]
	layoutKey: string
	hiddenByDefault: readonly string[]
	initialSort: SortingState
	onSelect: (process: ProcessRow) => void
	emptyText: ReactNode
	/** buttons after the ones of the table */
	actions?: ReactNode
}) {
	const [sorting, setSorting] = useState<SortingState>(initialSort)
	const [filter, setFilter] = useState("")
	const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
	const layout = useTableLayout(layoutKey, hiddenByDefault)
	const baseColumns = useProcessColumns(true)
	const columns = useMemo(
		() => (isReadOnlyUser() ? baseColumns : [selectionColumn<ProcessRow>(), ...baseColumns]),
		[baseColumns]
	)
	const systemsOfRows = useMemo(() => [...new Set(rows.map((row) => row.system))], [rows])
	const hosts = useHostFilters(systemsOfRows)
	const systems = useStore($allSystemsById)
	const { keeps } = hosts
	const data = useMemo(() => rows.filter((row) => keeps(row.system)), [rows, keeps])

	const table = useReactTable({
		data,
		columns,
		getRowId: (row) => `${row.system}/${row.pid}/${row.started ?? 0}`,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		onSortingChange: setSorting,
		onRowSelectionChange: setRowSelection,
		onColumnVisibilityChange: layout.onColumnVisibilityChange,
		onGlobalFilterChange: setFilter,
		globalFilterFn: (row, _columnId, value: string) => {
			const process = row.original
			const text = `${process.name} ${process.pid} ${process.user ?? ""} ${process.command ?? ""} ${
				systems[process.system]?.name ?? ""
			}`.toLowerCase()
			return value
				.toLowerCase()
				.split(" ")
				.filter(Boolean)
				.every((term) => text.includes(term))
		},
		state: { sorting, rowSelection, globalFilter: filter, columnVisibility: layout.columnVisibility },
	})
	const tableRows = table.getRowModel().rows
	const selectedItems = table.getFilteredSelectedRowModel().rows.map((row) => row.original)
	const hidden = tableRows.length - maxRows

	return (
		<>
			<div className="flex flex-wrap items-center gap-2 mb-3">
				<div className="relative flex-1 min-w-48 sm:max-w-64">
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
				<div className="flex flex-wrap gap-2 ms-auto">
					<HostFilters filters={hosts} />
					<ColumnsViewMenu table={table} />
					<BulkStateAlertsButton kind="process" items={selectedItems} />
					{actions}
				</div>
			</div>
			<div className={cn(tableHeight, "max-w-full relative overflow-auto border rounded-md")}>
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
							tableRows.slice(0, maxRows).map((row) => (
								<TableRow key={row.id} className="cursor-pointer" onClick={() => onSelect(row.original)}>
									{row.getVisibleCells().map((cell) => (
										<TableCell
											key={cell.id}
											className="py-2 ps-4.5"
											style={cellWidthStyle(layout.widths[cell.column.id], cell.column.columnDef.meta?.grow)}
										>
											{flexRender(cell.column.columnDef.cell, cell.getContext())}
										</TableCell>
									))}
								</TableRow>
							))
						) : (
							<TableRow>
								<TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
									{emptyText}
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</table>
			</div>
			{hidden > 0 && (
				<p className="text-xs text-muted-foreground mt-2">
					<Trans>{hidden} more processes: use the filter to find them.</Trans>
				</p>
			)}
		</>
	)
}

/* ------------------------------------------------------------------ */
/* Search                                                             */
/* ------------------------------------------------------------------ */

/** Columns of the search results hidden until the user shows them */
const searchHiddenByDefault = ["command", "threads", "status"]

/** Looks for a process on all the hosts that are up */
function ProcessSearch({
	systems,
	request,
	onSelect,
}: {
	systems: string[]
	request?: { q: string; n: number }
	onSelect: (process: ProcessRow) => void
}) {
	const [query, setQuery] = useState("")
	const [searched, setSearched] = useState("")
	const [loading, setLoading] = useState(false)
	const [results, setResults] = useState<ProcessesOverview[]>()

	const run = useCallback(
		async (text: string) => {
			const q = text.trim()
			if (!q || !systems.length) {
				return
			}
			setLoading(true)
			try {
				setResults(await fetchOverview(systems, { q }))
				setSearched(q)
			} finally {
				setLoading(false)
			}
		},
		[systems]
	)

	// a program chosen in the analysis of the fleet
	useEffect(() => {
		if (request) {
			setQuery(request.q)
			run(request.q)
		}
	}, [request])

	const matches = useMemo(() => (results ?? []).flatMap((overview) => overview.matches), [results])
	const matchCount = matches.length
	const systemCount = new Set(matches.map((process) => process.system)).size

	return (
		<Card className="@container w-full px-3 py-5 sm:py-6 sm:px-6">
			<BlockHeader
				title={<Trans>All processes</Trans>}
				description={<Trans>Looks for a process on all the systems that are up, by name, command, user or PID.</Trans>}
			/>
			<form
				onSubmit={(e: FormEvent) => {
					e.preventDefault()
					run(query)
				}}
				className="flex flex-wrap gap-2"
			>
				<div className="relative flex-1 min-w-48 max-w-xl">
					<Input
						placeholder={t`nginx, sqlservr, java…`}
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						className="ps-4 pe-10 w-full"
					/>
					{query && (
						<Button
							type="button"
							variant="ghost"
							size="icon"
							aria-label={t`Clear`}
							className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground"
							onClick={() => {
								setQuery("")
								setResults(undefined)
							}}
						>
							<XIcon className="h-4 w-4" />
						</Button>
					)}
				</div>
				<Button type="submit" variant="outline" disabled={loading || !query.trim() || !systems.length}>
					{loading ? (
						<LoaderCircleIcon className="me-1.5 size-4 animate-spin" />
					) : (
						<SearchIcon className="me-1.5 size-4" />
					)}
					<Trans>Search</Trans>
				</Button>
			</form>
			{results && (
				<div className="mt-4">
					<p className="text-sm text-muted-foreground mb-3 px-1">
						<Trans>
							{matchCount} process(es) on {systemCount} system(s) for “{searched}”
						</Trans>
					</p>
					{matches.length > 0 && (
						<ProcessesGrid
							key={searched}
							rows={matches}
							layoutKey="processes-search"
							hiddenByDefault={searchHiddenByDefault}
							initialSort={[{ id: "cpu", desc: true }]}
							onSelect={onSelect}
							emptyText={<Trans>No processes found.</Trans>}
						/>
					)}
					<Unanswered overviews={results} />
				</div>
			)}
		</Card>
	)
}

/* ------------------------------------------------------------------ */
/* Top consumers                                                      */
/* ------------------------------------------------------------------ */

type TopSort = "cpu" | "mem" | "name"

function TopConsumers({
	overviews,
	onSelect,
	actions,
}: {
	overviews: ProcessesOverview[]
	onSelect: (process: ProcessRow) => void
	actions?: ReactNode
}) {
	const allSystems = useStore($allSystemsById)
	const systemIds = useMemo(() => overviews.map((overview) => overview.system), [overviews])
	const hosts = useHostFilters(systemIds)
	const { keeps, brands } = hosts
	const [filter, setFilter] = useState("")
	const [loadedOnly, setLoadedOnly] = useState(false)
	const [sort, setSort] = useState<TopSort>("cpu")
	const [showAll, setShowAll] = useState(false)

	const isLoaded = (overview: ProcessesOverview) => overview.cpu >= loadedHost || overview.mem >= loadedHost

	const sorted = useMemo(() => {
		const list = overviews.filter((overview) => keeps(overview.system) && (!loadedOnly || isLoaded(overview)))
		// a filter keeps the systems of its name, or the processes of its name on the other systems
		const term = filter.trim().toLowerCase()
		const filtered = term
			? list.flatMap((overview) => {
					if ((allSystems[overview.system]?.name ?? "").toLowerCase().includes(term)) {
						return [overview]
					}
					const matches = (process: ProcessRow) => process.name.toLowerCase().includes(term)
					const topCpu = overview.topCpu.filter(matches)
					const topMem = overview.topMem.filter(matches)
					return topCpu.length || topMem.length ? [{ ...overview, topCpu, topMem }] : []
				})
			: list
		const name = (overview: ProcessesOverview) => allSystems[overview.system]?.name ?? overview.system
		return filtered.sort((a, b) =>
			sort === "name" ? name(a).localeCompare(name(b)) : sort === "mem" ? b.mem - a.mem : b.cpu - a.cpu
		)
	}, [overviews, allSystems, keeps, loadedOnly, sort, filter])

	// untouched, the block shows the first hosts in the order chosen; any filter shows all its hosts
	const limited = !showAll && !hosts.narrowed && !loadedOnly && !filter.trim()
	const shown = limited ? sorted.slice(0, defaultTopHosts) : sorted
	const moreHosts = sorted.length - shown.length

	const loadedCount = overviews.filter(isLoaded).length

	return (
		<>
			<div className="flex flex-wrap items-center gap-2 mb-3">
				<div className="relative flex-1 min-w-48 sm:max-w-64">
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
				<Button
					variant={loadedOnly ? "default" : "outline"}
					className="gap-1.5"
					onClick={() => setLoadedOnly(!loadedOnly)}
					aria-pressed={loadedOnly}
					title={t`Systems using at least half of their CPU or memory`}
				>
					<FlameIcon className="size-3.5" />
					<Trans>Loaded systems ({loadedCount})</Trans>
				</Button>
				<div className="flex flex-wrap gap-2 ms-auto">
					<Select value={sort} onValueChange={(value: TopSort) => setSort(value)}>
						<SelectTrigger className="w-auto min-w-40">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="cpu">
								<Trans>Busiest on CPU first</Trans>
							</SelectItem>
							<SelectItem value="mem">
								<Trans>Busiest on memory first</Trans>
							</SelectItem>
							<SelectItem value="name">
								<Trans>By name</Trans>
							</SelectItem>
						</SelectContent>
					</Select>
					<HostFilters filters={hosts} />
					{actions}
				</div>
			</div>
			{shown.length ? (
				<div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
					{shown.map((overview) => (
						<HostTop key={overview.system} overview={overview} brand={brands[overview.system]} onSelect={onSelect} />
					))}
				</div>
			) : (
				<p className="text-sm text-muted-foreground py-6 text-center">
					<Trans>No system matches the filters.</Trans>
				</p>
			)}
			{moreHosts > 0 && (
				<div className="flex justify-center mt-3">
					<Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => setShowAll(true)}>
						<ChevronDownIcon className="size-4" />
						<Plural value={moreHosts} one="Show # more system" other="Show # more systems" />
					</Button>
				</div>
			)}
		</>
	)
}

function HostTop({
	overview,
	brand,
	onSelect,
}: {
	overview: ProcessesOverview
	brand?: string
	onSelect: (process: ProcessRow) => void
}) {
	const count = overview.count
	const cpuText = percent(overview.cpu)
	const memText = percent(overview.mem)
	return (
		<div className="rounded-lg border p-3 grid gap-2 content-start">
			<div className="flex items-center gap-2 min-w-0">
				<ServerIcon className="size-4 text-muted-foreground shrink-0" />
				<SystemLink id={overview.system} />
				{brand && <span className="shrink-0 rounded border px-1.5 text-xs text-muted-foreground">{brand}</span>}
				<Button asChild variant="ghost" size="sm" className="ms-auto h-7 gap-1.5 shrink-0 text-muted-foreground">
					<Link href={`${systemPath(overview.system)}#processes`}>
						<ListTreeIcon className="size-3.5" />
						<Trans>Processes</Trans>
						<ArrowRightIcon className="size-3.5" />
					</Link>
				</Button>
			</div>
			<span className="text-xs text-muted-foreground tabular-nums -mt-1">
				<Trans>
					{count} processes · CPU {cpuText} · Memory {memText}
				</Trans>
			</span>
			<div className="grid grid-cols-2 gap-4">
				<TopList
					icon={CpuIcon}
					title={t`CPU`}
					processes={overview.topCpu}
					value={(process) => process.cpu}
					onSelect={onSelect}
				/>
				<TopList
					icon={MemoryStickIcon}
					title={t`Memory`}
					processes={overview.topMem}
					value={(process) => process.mem}
					onSelect={onSelect}
				/>
			</div>
		</div>
	)
}

function TopList({
	icon: Icon,
	title,
	processes,
	value,
	onSelect,
}: {
	icon: React.ElementType
	title: string
	processes: ProcessRow[]
	value: (process: ProcessRow) => number | undefined
	onSelect: (process: ProcessRow) => void
}) {
	// bars relative to the heaviest of the list
	const max = Math.max(...processes.map((process) => value(process) ?? 0), 0.0001)
	return (
		<div className="min-w-0">
			<div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1">
				<Icon className="size-3.5" />
				{title}
			</div>
			{processes.length ? (
				<ul className="grid gap-0.5">
					{processes.map((process, index) => (
						<li key={process.pid} className="min-w-0">
							<button
								type="button"
								onClick={() => onSelect(process)}
								className="relative w-full flex items-baseline gap-2 text-sm rounded px-1.5 py-0.5 hover:bg-accent/60 text-start overflow-hidden"
								title={process.command || process.name}
							>
								<span
									className={cn("absolute inset-y-0 start-0 rounded", rankColors[index] ?? rankColors.at(-1))}
									style={{ width: `${((value(process) ?? 0) / max) * 100}%` }}
								/>
								<span className="relative min-w-0 truncate">{process.name}</span>
								<span className={cn("relative ms-auto shrink-0 tabular-nums text-xs", usageClass(value(process)))}>
									{percent(value(process))}
								</span>
							</button>
						</li>
					))}
				</ul>
			) : (
				<p className="text-sm text-muted-foreground">-</p>
			)}
		</div>
	)
}

/** Colors of the bars of the top lists, from the heaviest process to the lightest */
const rankColors = [
	"bg-red-500/40",
	"bg-orange-500/35",
	"bg-amber-500/35",
	"bg-yellow-500/30",
	"bg-lime-500/30",
	"bg-green-500/30",
	"bg-emerald-500/30",
	"bg-teal-500/30",
	"bg-cyan-500/30",
	"bg-sky-500/30",
]

/* ------------------------------------------------------------------ */
/* Programs of the fleet                                              */
/* ------------------------------------------------------------------ */

/** A program across the fleet: the systems running it and its instances added up */
interface FleetProgram {
	name: string
	systems: string[]
	count: number
	/** the highest CPU of the program on a system, percent of that system */
	cpuMax: number
	rss: number
}

/** Rows shown at most in the table of the programs; the filter finds the others */
const maxProgramRows = 300

function FleetPrograms({
	overviews,
	onSearch,
	actions,
}: {
	overviews: ProcessesOverview[]
	onSearch: (q: string) => void
	actions?: ReactNode
}) {
	const allSystems = useStore($allSystemsById)
	const [filter, setFilter] = useState("")
	const [sorting, setSorting] = useState<SortingState>([{ id: "systems", desc: true }])
	const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
	const layout = useTableLayout("fleet-programs")
	const systemIds = useMemo(() => overviews.map((overview) => overview.system), [overviews])
	const hosts = useHostFilters(systemIds)
	const { keeps } = hosts

	const programs = useMemo(() => {
		const byName = new Map<string, FleetProgram>()
		for (const overview of overviews) {
			if (!keeps(overview.system)) {
				continue
			}
			for (const program of overview.programs) {
				const fleet = byName.get(program.name) ?? { name: program.name, systems: [], count: 0, cpuMax: 0, rss: 0 }
				fleet.systems.push(overview.system)
				fleet.count += program.count
				fleet.cpuMax = Math.max(fleet.cpuMax, program.cpu)
				fleet.rss += program.rss
				byName.set(program.name, fleet)
			}
		}
		return [...byName.values()]
	}, [overviews, keeps])

	const columns = useMemo((): ColumnDef<FleetProgram>[] => {
		const list: ColumnDef<FleetProgram>[] = [
			{
				id: "name",
				accessorFn: (row) => row.name,
				enableHiding: false,
				header: ({ column }) => <HeaderButton column={column} name={t`Program`} Icon={BoxesIcon} />,
				cell: ({ row }) => <span className="ms-1.5 block max-w-72 truncate font-medium">{row.original.name}</span>,
			},
			{
				id: "systems",
				// the names of the systems fill the width of the column, truncated only when it is too narrow
				meta: { name: () => t`Systems`, grow: true },
				accessorFn: (row) => row.systems.length,
				sortDescFirst: true,
				header: ({ column }) => <HeaderButton column={column} name={t`Systems`} Icon={ServerIcon} />,
				cell: ({ row }) => {
					const names = row.original.systems.map((id) => allSystems[id]?.name ?? id).join(", ")
					return (
						<span className="ms-1.5 flex items-baseline gap-2 min-w-0" title={names}>
							<span className="tabular-nums shrink-0">{row.original.systems.length}</span>
							<span className="truncate text-xs text-muted-foreground">{names}</span>
						</span>
					)
				},
			},
			{
				id: "count",
				meta: { name: () => t`Instances` },
				accessorFn: (row) => row.count,
				sortDescFirst: true,
				header: ({ column }) => <HeaderButton column={column} name={t`Instances`} Icon={LayersIcon} />,
				cell: ({ row }) => <span className="ms-1.5 tabular-nums">{row.original.count}</span>,
			},
			{
				id: "cpu",
				meta: { name: () => t`CPU max` },
				accessorFn: (row) => row.cpuMax,
				sortDescFirst: true,
				header: ({ column }) => <HeaderButton column={column} name={t`CPU max`} Icon={CpuIcon} />,
				cell: ({ row }) => (
					<span className={cn("ms-1.5 tabular-nums", usageClass(row.original.cpuMax))}>
						{percent(row.original.cpuMax)}
					</span>
				),
			},
			{
				id: "rss",
				meta: { name: () => t`Total memory` },
				accessorFn: (row) => row.rss,
				sortDescFirst: true,
				header: ({ column }) => <HeaderButton column={column} name={t`Total memory`} Icon={MemoryStickIcon} />,
				cell: ({ row }) => <span className="ms-1.5 tabular-nums">{formatSize(row.original.rss)}</span>,
			},
		]
		return isReadOnlyUser() ? list : [selectionColumn<FleetProgram>(), ...list]
	}, [allSystems])

	const table = useReactTable({
		data: programs,
		columns,
		getRowId: (row) => row.name,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		onSortingChange: setSorting,
		onRowSelectionChange: setRowSelection,
		onColumnVisibilityChange: layout.onColumnVisibilityChange,
		onGlobalFilterChange: setFilter,
		globalFilterFn: (row, _columnId, value: string) => row.original.name.toLowerCase().includes(value.toLowerCase()),
		state: { sorting, rowSelection, globalFilter: filter, columnVisibility: layout.columnVisibility },
	})
	const rows = table.getRowModel().rows
	// the selected programs on each system running them, for the alerts and quiet hours
	const selectedItems = table
		.getFilteredSelectedRowModel()
		.rows.flatMap((row) => row.original.systems.map((system) => ({ name: row.original.name, system })))
	const programCount = programs.length
	const hidden = rows.length - maxProgramRows

	return (
		<>
			<p className="text-sm text-muted-foreground mb-2 px-1">
				<Trans>{programCount} programs</Trans>
			</p>
			<div className="flex flex-wrap items-center gap-2 mb-3">
				<div className="relative flex-1 min-w-48 sm:max-w-64">
					<Input placeholder={t`Filter...`} value={filter} onChange={(e) => setFilter(e.target.value)} />
				</div>
				<div className="flex flex-wrap gap-2 ms-auto">
					<HostFilters filters={hosts} />
					<ColumnsViewMenu table={table} />
					<BulkStateAlertsButton kind="process" items={selectedItems} />
					{actions}
				</div>
			</div>
			<div className={cn(tableHeight, "overflow-auto border rounded-md")}>
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
						{rows.slice(0, maxProgramRows).map((row) => (
							<TableRow key={row.id} className="cursor-pointer" onClick={() => onSearch(row.original.name)}>
								{row.getVisibleCells().map((cell) => (
									<TableCell
										key={cell.id}
										className="py-2 ps-4.5"
										style={cellWidthStyle(layout.widths[cell.column.id], cell.column.columnDef.meta?.grow)}
										{...resizedAttr(layout.widths[cell.column.id], cell.column.columnDef.meta?.grow)}
									>
										{flexRender(cell.column.columnDef.cell, cell.getContext())}
									</TableCell>
								))}
							</TableRow>
						))}
					</TableBody>
				</table>
			</div>
			{hidden > 0 && (
				<p className="text-xs text-muted-foreground mt-2">
					<Trans>{hidden} more programs: use the filter to find them.</Trans>
				</p>
			)}
		</>
	)
}

/* ------------------------------------------------------------------ */
/* Recently started                                                   */
/* ------------------------------------------------------------------ */

/** Columns of the recent processes hidden until the user shows them */
const recentHiddenByDefault = ["command", "threads", "status", "dr", "dw", "conns"]

function RecentStarts({
	overviews,
	onSelect,
	actions,
}: {
	overviews: ProcessesOverview[]
	onSelect: (process: ProcessRow) => void
	actions?: ReactNode
}) {
	const recent = useMemo(() => overviews.flatMap((overview) => overview.recent), [overviews])
	return (
		<ProcessesGrid
			rows={recent}
			layoutKey="processes-recent"
			hiddenByDefault={recentHiddenByDefault}
			initialSort={[{ id: "started", desc: true }]}
			onSelect={onSelect}
			emptyText={<Trans>No process started in the last 24 hours.</Trans>}
			actions={actions}
		/>
	)
}
