import { Trans, useLingui } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { subscribeKeys } from "nanostores"
import { getPagePath } from "@nanostores/router"
import {
	type ColumnDef,
	type ColumnFiltersState,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getSortedRowModel,
	type Row,
	type SortingState,
	type Table as TableType,
	useReactTable,
	type VisibilityState,
} from "@tanstack/react-table"
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual"
import {
	ArrowDownIcon,
	ArrowUpDownIcon,
	ArrowUpIcon,
	BellIcon,
	EyeIcon,
	FilterIcon,
	FolderCogIcon,
	FolderIcon,
	FolderOpenIcon,
	LayersIcon,
	LayoutGridIcon,
	LayoutListIcon,
	Settings2Icon,
	XIcon,
} from "lucide-react"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
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
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { SystemStatus } from "@/lib/enums"
import { isReadOnlyUser, queueUserSettings } from "@/lib/api"
import { alertInfo } from "@/lib/alerts"
import { $stateAlerts } from "@/lib/state-alerts"
import { $alerts, $downSystems, $pausedSystems, $systems, $upSystems, $userSettings } from "@/lib/stores"
import {
	$systemGroups,
	alertFilterAny,
	alertFilterState,
	allGroupsTab,
	groupSystems,
	groupTab,
	inGroupTab,
	matchesAlertFilter,
	systemGroup,
	ungroupedTab,
} from "@/lib/system-groups"
import { cn, runOnce } from "@/lib/utils"
import type { SystemRecord, UserSettings } from "@/types"
import AlertButton from "../alerts/alert-button"
import { $router, Link } from "../router"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card"
import { AgentUpdateButton } from "../agent-update-dialog"
import { type ColumnResizeHandler, ColumnResizer, resizedAttr } from "../table-layout"
import { type OverflowTab, OverflowTabs } from "../overflow-tabs"
import { ManageGroupsDialog } from "./groups-dialog"
import { SystemsTableColumns, ActionsButton, IndicatorDot } from "./systems-table-columns"

type ViewMode = "table" | "grid"
type StatusFilter = "all" | SystemRecord["status"]

const preloadSystemDetail = runOnce(() => import("@/components/routes/system.tsx"))

export default function SystemsTable() {
	const data = useStore($systems)
	const downSystems = $downSystems.get()
	const upSystems = $upSystems.get()
	const pausedSystems = $pausedSystems.get()
	const { i18n, t } = useLingui()
	const [filter, setFilter] = useState<string>("")
	const [statusFilter, setStatusFilter] = useState<StatusFilter>(
		() =>
			$userSettings.get().statusFilter ??
			(JSON.parse(localStorage.getItem("besz-statusFilter") || "null") as StatusFilter | null) ??
			"all"
	)
	const [sorting, setSorting] = useState<SortingState>(
		() =>
			$userSettings.get().sortMode ??
			JSON.parse(sessionStorage.getItem("besz-sortMode") || "null") ?? [{ id: "system", desc: false }]
	)
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
	const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
		() => $userSettings.get().cols ?? JSON.parse(localStorage.getItem("besz-cols") || "{}")
	)
	// groups and alerts shown, chosen in the view options
	const [groupView, setGroupView] = useState(() => $userSettings.get().groupView ?? false)
	const [alertFilter, setAlertFilter] = useState(() => $userSettings.get().alertFilter ?? "")
	const [activeGroupTab, setActiveGroupTab] = useState(() => $userSettings.get().groupTab ?? allGroupsTab)
	const [groupsDialogOpen, setGroupsDialogOpen] = useState(false)
	const [colWidths, setColWidths] = useState<Record<string, number>>(() => $userSettings.get().colWidths ?? {})
	const groupNames = useStore($systemGroups)
	const alerts = useStore($alerts)
	const stateAlerts = useStore($stateAlerts)

	// Apply settings from server once they load (handles incognito / new devices)
	const applied = useRef(new Set<string>())
	useEffect(() => {
		return subscribeKeys($userSettings, ["cols", "statusFilter", "viewMode", "sortMode", "groupView", "alertFilter", "groupTab", "colWidths"], (vals) => {
			if (!applied.current.has("cols") && vals.cols !== undefined) {
				applied.current.add("cols")
				setColumnVisibility(vals.cols)
			}
			if (!applied.current.has("statusFilter") && vals.statusFilter !== undefined) {
				applied.current.add("statusFilter")
				setStatusFilter(vals.statusFilter)
			}
			if (!applied.current.has("viewMode") && vals.viewMode !== undefined) {
				applied.current.add("viewMode")
				setViewMode(vals.viewMode)
			}
			if (!applied.current.has("sortMode") && vals.sortMode !== undefined) {
				applied.current.add("sortMode")
				setSorting(vals.sortMode)
			}
			if (!applied.current.has("groupView") && vals.groupView !== undefined) {
				applied.current.add("groupView")
				setGroupView(vals.groupView)
			}
			if (!applied.current.has("alertFilter") && vals.alertFilter !== undefined) {
				applied.current.add("alertFilter")
				setAlertFilter(vals.alertFilter)
			}
			if (!applied.current.has("groupTab") && vals.groupTab !== undefined) {
				applied.current.add("groupTab")
				setActiveGroupTab(vals.groupTab)
			}
			if (!applied.current.has("colWidths") && vals.colWidths !== undefined) {
				applied.current.add("colWidths")
				setColWidths(vals.colWidths)
			}
		})
	}, [])

	const handleColumnVisibilityChange = useCallback(
		(updater: VisibilityState | ((prev: VisibilityState) => VisibilityState)) => {
			setColumnVisibility((prev) => {
				const next = typeof updater === "function" ? updater(prev) : updater
				localStorage.setItem("besz-cols", JSON.stringify(next))
				$userSettings.setKey("cols", next)
				queueUserSettings({ cols: next })
				return next
			})
		},
		[]
	)

	const handleStatusFilterChange = useCallback((value: string) => {
		const next = value as StatusFilter
		setStatusFilter(next)
		localStorage.setItem("besz-statusFilter", JSON.stringify(next))
		$userSettings.setKey("statusFilter", next)
		queueUserSettings({ statusFilter: next })
	}, [])

	const handleViewModeChange = useCallback((view: string) => {
		const next = view as ViewMode
		setViewMode(next)
		localStorage.setItem("besz-viewMode", JSON.stringify(next))
		$userSettings.setKey("viewMode", next)
		queueUserSettings({ viewMode: next })
	}, [])

	const handleSortingChange = useCallback((updater: SortingState | ((prev: SortingState) => SortingState)) => {
		setSorting((prev) => {
			const next = typeof updater === "function" ? updater(prev) : updater
			sessionStorage.setItem("besz-sortMode", JSON.stringify(next))
			$userSettings.setKey("sortMode", next)
			queueUserSettings({ sortMode: next })
			return next
		})
	}, [])

	// save a view preference of the user
	const saveViewSetting = useCallback(
		<K extends "groupView" | "alertFilter" | "groupTab" | "colWidths">(key: K, value: UserSettings[K]) => {
			$userSettings.setKey(key, value)
			queueUserSettings({ [key]: value })
		},
		[]
	)

	const handleGroupViewChange = useCallback((value: boolean) => {
		setGroupView(value)
		saveViewSetting("groupView", value)
	}, [])

	const handleGroupTabChange = useCallback((value: string) => {
		setActiveGroupTab(value)
		saveViewSetting("groupTab", value)
	}, [])

	// width of a column while it is resized, saved when the resize ends; undefined resets it
	const handleColumnResize = useCallback((columnId: string, width: number | undefined, done: boolean) => {
		setColWidths((current) => {
			const { [columnId]: _, ...rest } = current
			const next = width === undefined ? rest : { ...current, [columnId]: width }
			if (done) {
				saveViewSetting("colWidths", next)
			}
			return next
		})
	}, [])

	const handleAlertFilterChange = useCallback((value: string) => {
		const next = value === "all" ? "" : value
		setAlertFilter(next)
		saveViewSetting("alertFilter", next)
	}, [])

	// alert names configured on the systems, in the order of the alert settings
	const alertNames = useMemo(() => {
		const names = new Set<string>()
		for (const systemAlerts of Object.values(alerts)) {
			for (const name of systemAlerts.keys()) {
				names.add(name)
			}
		}
		return Object.keys(alertInfo).filter((name) => names.has(name))
	}, [alerts])
	const hasStateRules = Object.keys(stateAlerts).length > 0

	const locale = i18n.locale

	// Filter data based on status filter
	const statusData = useMemo(() => {
		if (statusFilter === "all") {
			return data
		}
		if (statusFilter === SystemStatus.Up) {
			return Object.values(upSystems) ?? []
		}
		if (statusFilter === SystemStatus.Down) {
			return Object.values(downSystems) ?? []
		}
		return Object.values(pausedSystems) ?? []
	}, [data, statusFilter])

	// then on the alerts chosen in the view options
	const alertData = useMemo(
		() => (alertFilter ? statusData.filter((system) => matchesAlertFilter(system, alertFilter)) : statusData),
		[statusData, alertFilter, alerts, stateAlerts]
	)

	// systems of each group tab
	const groupCounts = useMemo(() => {
		const counts: Record<string, number> = { [allGroupsTab]: alertData.length }
		for (const system of alertData) {
			const tab = groupTab(systemGroup(system))
			counts[tab] = (counts[tab] ?? 0) + 1
		}
		return counts
	}, [alertData])
	const hasUngrouped = data.some((system) => !systemGroup(system))
	// back to all systems when the group of the tab no longer exists
	const groupTabShown =
		groupNames.some((group) => groupTab(group) === activeGroupTab) || (activeGroupTab === ungroupedTab && hasUngrouped)
			? activeGroupTab
			: allGroupsTab

	// then on the group tab
	const filteredData = useMemo(
		() =>
			groupTabShown === allGroupsTab ? alertData : alertData.filter((system) => inGroupTab(system, groupTabShown)),
		[alertData, groupTabShown]
	)
	const grouped = groupView && groupTabShown === allGroupsTab

	const [viewMode, setViewMode] = useState<ViewMode>(
		() =>
			$userSettings.get().viewMode ??
			(JSON.parse(localStorage.getItem("besz-viewMode") || "null") as ViewMode | null) ??
			// show grid view on mobile if there are less than 200 systems (looks better but table is more efficient)
			(window.innerWidth < 1024 && filteredData.length < 200 ? "grid" : "table")
	)

	useEffect(() => {
		if (filter !== undefined) {
			table.getColumn("system")?.setFilterValue(filter)
		}
	}, [filter])

	const columnDefs = useMemo(() => SystemsTableColumns(viewMode), [viewMode])

	const table = useReactTable({
		data: filteredData,
		columns: columnDefs,
		getCoreRowModel: getCoreRowModel(),
		onSortingChange: handleSortingChange,
		getSortedRowModel: getSortedRowModel(),
		onColumnFiltersChange: setColumnFilters,
		getFilteredRowModel: getFilteredRowModel(),
		onColumnVisibilityChange: handleColumnVisibilityChange,
		state: {
			sorting,
			columnFilters,
			columnVisibility,
		},
		defaultColumn: {
			invertSorting: true,
			sortUndefined: "last",
			minSize: 0,
			size: 900,
			maxSize: 900,
		},
	})

	const rows = table.getRowModel().rows
	const columns = table.getAllColumns()
	const visibleColumns = table.getVisibleLeafColumns()

	const [upSystemsLength, downSystemsLength, pausedSystemsLength] = useMemo(() => {
		return [Object.values(upSystems).length, Object.values(downSystems).length, Object.values(pausedSystems).length]
	}, [upSystems, downSystems, pausedSystems])

	const CardHead = useMemo(() => {
		return (
			<CardHeader className="p-0 mb-3 sm:mb-4">
				<div className="grid md:flex gap-x-5 gap-y-3 w-full items-end">
					<div className="px-2 sm:px-1">
						<CardTitle className="mb-2">
							<Trans>All Systems</Trans>
						</CardTitle>
						<CardDescription className="flex">
							<Trans>Click on a system to view more information.</Trans>
						</CardDescription>
					</div>

					<div className="flex gap-2 ms-auto w-full md:w-auto">
						<div className="relative flex-1 md:w-56">
							<Input
								placeholder={t`Filter...`}
								onChange={(e) => setFilter(e.target.value)}
								value={filter}
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
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="outline">
									<Settings2Icon className="me-1.5 size-4 opacity-80" />
									<Trans>View</Trans>
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="h-72 md:h-auto min-w-48 md:min-w-auto overflow-y-auto">
								<div className="grid grid-cols-1 md:grid-cols-5 divide-y md:divide-s md:divide-y-0">
									<div className="border-r">
										<DropdownMenuLabel className="pt-2 px-3.5 flex items-center gap-2">
											<LayoutGridIcon className="size-4" />
											<Trans>Layout</Trans>
										</DropdownMenuLabel>
										<DropdownMenuSeparator />
										<DropdownMenuRadioGroup className="px-1 pb-1" value={viewMode} onValueChange={handleViewModeChange}>
											<DropdownMenuRadioItem value="table" onSelect={(e) => e.preventDefault()} className="gap-2">
												<LayoutListIcon className="size-4" />
												<Trans>Table</Trans>
											</DropdownMenuRadioItem>
											<DropdownMenuRadioItem value="grid" onSelect={(e) => e.preventDefault()} className="gap-2">
												<LayoutGridIcon className="size-4" />
												<Trans>Grid</Trans>
											</DropdownMenuRadioItem>
										</DropdownMenuRadioGroup>
									</div>

									<div className="border-r">
										<DropdownMenuLabel className="pt-2 px-3.5 flex items-center gap-2">
											<FilterIcon className="size-4" />
											<Trans>Status</Trans>
										</DropdownMenuLabel>
										<DropdownMenuSeparator />
										<DropdownMenuRadioGroup
											className="px-1 pb-1"
											value={statusFilter}
											onValueChange={handleStatusFilterChange}
										>
											<DropdownMenuRadioItem value="all" onSelect={(e) => e.preventDefault()}>
												<Trans>All Systems</Trans>
											</DropdownMenuRadioItem>
											<DropdownMenuRadioItem value="up" onSelect={(e) => e.preventDefault()}>
												<Trans>Up ({upSystemsLength})</Trans>
											</DropdownMenuRadioItem>
											<DropdownMenuRadioItem value="down" onSelect={(e) => e.preventDefault()}>
												<Trans>Down ({downSystemsLength})</Trans>
											</DropdownMenuRadioItem>
											<DropdownMenuRadioItem value="paused" onSelect={(e) => e.preventDefault()}>
												<Trans>Paused ({pausedSystemsLength})</Trans>
											</DropdownMenuRadioItem>
										</DropdownMenuRadioGroup>
									</div>

									<div className="border-r">
										<DropdownMenuLabel className="pt-2 px-3.5 flex items-center gap-2">
											<FolderIcon className="size-4" />
											<Trans>Groups</Trans>
										</DropdownMenuLabel>
										<DropdownMenuSeparator />
										<div className="px-1.5 pb-1">
											<DropdownMenuCheckboxItem
												onSelect={(e) => e.preventDefault()}
												checked={groupView}
												onCheckedChange={(value) => handleGroupViewChange(!!value)}
											>
												<Trans>Show by group</Trans>
											</DropdownMenuCheckboxItem>
											{!isReadOnlyUser() && (
												<DropdownMenuItem className="gap-2" onSelect={() => setGroupsDialogOpen(true)}>
													<FolderCogIcon className="size-4" />
													<Trans>Manage groups</Trans>
												</DropdownMenuItem>
											)}
										</div>
										<DropdownMenuLabel className="pt-2 px-3.5 flex items-center gap-2">
											<BellIcon className="size-4" />
											<Trans>Alerts</Trans>
										</DropdownMenuLabel>
										<DropdownMenuSeparator />
										<DropdownMenuRadioGroup
											className="px-1 pb-1"
											value={alertFilter || "all"}
											onValueChange={handleAlertFilterChange}
										>
											<DropdownMenuRadioItem value="all" onSelect={(e) => e.preventDefault()}>
												<Trans>All Systems</Trans>
											</DropdownMenuRadioItem>
											<DropdownMenuRadioItem value={alertFilterAny} onSelect={(e) => e.preventDefault()}>
												<Trans>With alerts</Trans>
											</DropdownMenuRadioItem>
											{alertNames.map((name) => (
												<DropdownMenuRadioItem key={name} value={name} onSelect={(e) => e.preventDefault()}>
													{alertInfo[name].name()}
												</DropdownMenuRadioItem>
											))}
											{hasStateRules && (
												<DropdownMenuRadioItem value={alertFilterState} onSelect={(e) => e.preventDefault()}>
													<Trans>State rules</Trans>
												</DropdownMenuRadioItem>
											)}
										</DropdownMenuRadioGroup>
									</div>

									<div className="border-r">
										<DropdownMenuLabel className="pt-2 px-3.5 flex items-center gap-2">
											<ArrowUpDownIcon className="size-4" />
											<Trans>Sort By</Trans>
										</DropdownMenuLabel>
										<DropdownMenuSeparator />
										<div className="px-1 pb-1">
											{columns.map((column) => {
												if (!column.getCanSort()) return null
												let Icon = <span className="w-6"></span>
												// if current sort column, show sort direction
												if (sorting[0]?.id === column.id) {
													if (sorting[0]?.desc) {
														Icon = <ArrowUpIcon className="me-2 size-4" />
													} else {
														Icon = <ArrowDownIcon className="me-2 size-4" />
													}
												}
												return (
													<DropdownMenuItem
														onSelect={(e) => {
															e.preventDefault()
															handleSortingChange([
																{ id: column.id, desc: sorting[0]?.id === column.id && !sorting[0]?.desc },
															])
														}}
														key={column.id}
													>
														{Icon}
														{/* @ts-ignore */}
														{column.columnDef.name()}
													</DropdownMenuItem>
												)
											})}
										</div>
									</div>

									<div>
										<DropdownMenuLabel className="pt-2 px-3.5 flex items-center gap-2">
											<EyeIcon className="size-4" />
											<Trans>Visible Fields</Trans>
										</DropdownMenuLabel>
										<DropdownMenuSeparator />
										<div className="px-1.5 pb-1">
											{columns
												.filter((column) => column.getCanHide())
												.map((column) => {
													return (
														<DropdownMenuCheckboxItem
															key={column.id}
															onSelect={(e) => e.preventDefault()}
															checked={column.getIsVisible()}
															onCheckedChange={(value) => column.toggleVisibility(!!value)}
														>
															{/* @ts-ignore */}
															{column.columnDef.name()}
														</DropdownMenuCheckboxItem>
													)
												})}
										</div>
									</div>
								</div>
							</DropdownMenuContent>
						</DropdownMenu>
						<AgentUpdateButton />
					</div>
				</div>
			</CardHeader>
		)
	}, [
		visibleColumns.length,
		sorting,
		viewMode,
		locale,
		statusFilter,
		upSystemsLength,
		downSystemsLength,
		pausedSystemsLength,
		filter,
		groupView,
		groupNames,
		alertFilter,
		alertNames,
		hasStateRules,
	])

	return (
		<Card className="w-full px-3 py-5 sm:py-6 sm:px-6">
			{CardHead}
			{groupNames.length > 0 && (
				<GroupTabs
					value={groupTabShown}
					onChange={handleGroupTabChange}
					groups={groupNames}
					counts={groupCounts}
					showUngrouped={hasUngrouped}
					onManage={() => setGroupsDialogOpen(true)}
				/>
			)}
			<Dialog open={groupsDialogOpen} onOpenChange={setGroupsDialogOpen}>
				{groupsDialogOpen && (
					<ManageGroupsDialog
						initialGroup={groupNames.find((group) => groupTab(group) === groupTabShown)}
						onDone={() => setGroupsDialogOpen(false)}
					/>
				)}
			</Dialog>
			{viewMode === "table" ? (
				// table layout
				<div className="rounded-md">
					<AllSystemsTable
						table={table}
						rows={rows}
						colLength={visibleColumns.length}
						grouped={grouped}
						colWidths={colWidths}
						onColumnResize={handleColumnResize}
					/>
				</div>
			) : grouped && rows.length ? (
				// grid layout by group
				<div className="grid gap-6">
					{groupSystems(rows, (row) => row.original).map(([group, groupRows]) => (
						<section key={group || "-"} className="grid gap-3">
							<GroupHeading name={group} count={groupRows.length} />
							<div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
								{groupRows.map((row) => (
									<SystemCard key={row.original.id} row={row} table={table} colLength={visibleColumns.length} />
								))}
							</div>
						</section>
					))}
				</div>
			) : (
				// grid layout
				<div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
					{rows?.length ? (
						rows.map((row) => {
							return <SystemCard key={row.original.id} row={row} table={table} colLength={visibleColumns.length} />
						})
					) : (
						<div className="col-span-full text-center py-8">
							<Trans>No systems found.</Trans>
						</div>
					)}
				</div>
			)}
		</Card>
	)
}

/** Tabs showing all systems or the systems of a group, with the number of systems of each */
function GroupTabs({
	value,
	onChange,
	groups,
	counts,
	showUngrouped,
	onManage,
}: {
	value: string
	onChange: (value: string) => void
	groups: string[]
	counts: Record<string, number>
	showUngrouped: boolean
	onManage: () => void
}) {
	const { t } = useLingui()
	const tabs = useMemo(() => {
		const count = (tab: string) => (
			<span className="ms-1 rounded-full bg-muted-foreground/15 px-1.5 text-xs tabular-nums">{counts[tab] ?? 0}</span>
		)
		const tabs: OverflowTab[] = [
			{
				value: allGroupsTab,
				label: (
					<>
						<LayersIcon className="size-3.5" />
						<Trans>All</Trans>
						{count(allGroupsTab)}
					</>
				),
			},
			...groups.map((group) => ({
				value: groupTab(group),
				title: group,
				label: (
					<>
						<FolderIcon className="size-3.5 shrink-0" />
						<span className="max-w-48 truncate">{group}</span>
						{count(groupTab(group))}
					</>
				),
			})),
		]
		if (showUngrouped) {
			tabs.push({
				value: ungroupedTab,
				label: (
					<>
						<FolderOpenIcon className="size-3.5" />
						<Trans>No group</Trans>
						{count(ungroupedTab)}
					</>
				),
			})
		}
		return tabs
	}, [groups, counts, showUngrouped])
	return (
		<div className="flex items-center gap-2 mb-3 sm:mb-4">
			<OverflowTabs tabs={tabs} value={value} onChange={onChange} className="min-w-0 flex-1" />
			{!isReadOnlyUser() && (
				<Button
					variant="ghost"
					size="icon"
					className="shrink-0"
					aria-label={t`Manage groups`}
					title={t`Manage groups`}
					onClick={onManage}
				>
					<FolderCogIcon className="size-4" />
				</Button>
			)}
		</div>
	)
}

/** Heading of a group of systems */
function GroupHeading({ name, count }: { name: string; count: number }) {
	return (
		<div className="flex items-center gap-2 text-sm font-medium">
			<FolderIcon className="size-4 text-muted-foreground" />
			{name || <Trans>No group</Trans>}
			<span className="text-muted-foreground tabular-nums">({count})</span>
		</div>
	)
}

/** Row of the systems table: a system, or the heading of a group */
type TableItem = Row<SystemRecord> | { group: string; count: number }

const isGroupItem = (item: TableItem): item is { group: string; count: number } => !("original" in item)

const AllSystemsTable = memo(
	({
		table,
		rows,
		colLength,
		grouped,
		colWidths,
		onColumnResize,
	}: {
		table: TableType<SystemRecord>
		rows: Row<SystemRecord>[]
		colLength: number
		grouped: boolean
		colWidths: Record<string, number>
		onColumnResize: ColumnResizeHandler
	}) => {
		// The virtualizer will need a reference to the scrollable container element
		const scrollRef = useRef<HTMLDivElement>(null)

		// systems, preceded by the heading of their group when shown by group
		const items = useMemo<TableItem[]>(
			() =>
				grouped
					? groupSystems(rows, (row) => row.original).flatMap(([group, groupRows]) => [
							{ group, count: groupRows.length },
							...groupRows,
						])
					: rows,
			[rows, grouped]
		)

		const virtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
			count: items.length,
			estimateSize: () => (rows.length > 10 ? 56 : 60),
			getScrollElement: () => scrollRef.current,
			overscan: 5,
		})
		const virtualRows = virtualizer.getVirtualItems()

		const paddingTop = Math.max(0, virtualRows[0]?.start ?? 0 - virtualizer.options.scrollMargin)
		const paddingBottom = Math.max(0, virtualizer.getTotalSize() - (virtualRows[virtualRows.length - 1]?.end ?? 0))

		return (
			<div
				className={cn(
					"h-min max-h-[calc(100dvh-17rem)] max-w-full relative overflow-auto border rounded-md",
					// don't set min height if there are less than 2 rows, do set if we need to display the empty state
					(!rows.length || rows.length > 2) && "min-h-50"
				)}
				ref={scrollRef}
			>
				{/* add header height to table size */}
				<div style={{ height: `${virtualizer.getTotalSize() + 50}px`, paddingTop, paddingBottom }}>
					<table className="text-sm w-full h-full">
						<SystemsTableHead table={table} colWidths={colWidths} onColumnResize={onColumnResize} />
						<TableBody onMouseEnter={preloadSystemDetail}>
							{rows.length ? (
								virtualRows.map((virtualRow) => {
									const item = items[virtualRow.index]
									if (isGroupItem(item)) {
										return (
											<TableRow key={`group-${item.group}`} className="hover:bg-transparent">
												<TableCell
													colSpan={colLength}
													className="py-0 ps-4 bg-muted/40"
													style={{ height: virtualRow.size }}
												>
													<GroupHeading name={item.group} count={item.count} />
												</TableCell>
											</TableRow>
										)
									}
									const row = item
									return (
										<SystemTableRow
											key={row.id}
											row={row}
											virtualRow={virtualRow}
											length={rows.length}
											colLength={colLength}
											colWidths={colWidths}
										/>
									)
								})
							) : (
								<TableRow>
									<TableCell colSpan={colLength} className="h-37 text-center pointer-events-none">
										<Trans>No systems found.</Trans>
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</table>
				</div>
			</div>
		)
	}
)

function SystemsTableHead({
	table,
	colWidths,
	onColumnResize,
}: {
	table: TableType<SystemRecord>
	colWidths: Record<string, number>
	onColumnResize: ColumnResizeHandler
}) {
	const { t } = useLingui()
	return (
		<TableHeader className="sticky top-0 z-50 w-full border-b-2">
			{table.getHeaderGroups().map((headerGroup) => (
				<tr key={headerGroup.id}>
					{headerGroup.headers.map((header) => {
						const width = colWidths[header.column.id]
						return (
							<TableHead
								className="px-1.5 relative"
								key={header.id}
								style={width ? { width, minWidth: width, maxWidth: width } : undefined}
							>
								{flexRender(header.column.columnDef.header, header.getContext())}
								{header.column.id !== "actions" && (
									<ColumnResizer columnId={header.column.id} onColumnResize={onColumnResize} />
								)}
							</TableHead>
						)
					})}
				</tr>
			))}
		</TableHeader>
	)
}

const SystemTableRow = memo(
	({
		row,
		virtualRow,
		colLength,
		colWidths,
	}: {
		row: Row<SystemRecord>
		virtualRow: VirtualItem
		length: number
		colLength: number
		colWidths: Record<string, number>
	}) => {
		const system = row.original
		const { t } = useLingui()
		return useMemo(() => {
			return (
				<TableRow
					// data-state={row.getIsSelected() && "selected"}
					className={cn("cursor-pointer transition-opacity relative safari:transform-3d", {
						"opacity-50": system.status === SystemStatus.Paused,
					})}
				>
					{row.getVisibleCells().map((cell) => {
						const width = colWidths[cell.column.id]
						return (
							<TableCell
								key={cell.id}
								style={{
									width: width ?? cell.column.getSize(),
									maxWidth: width,
									height: virtualRow.size,
								}}
								className={cn("py-0 ps-4.5", width && "overflow-hidden")}
								{...resizedAttr(width)}
							>
								{flexRender(cell.column.columnDef.cell, cell.getContext())}
							</TableCell>
						)
					})}
				</TableRow>
			)
		}, [system, system.status, colLength, colWidths, t])
	}
)

const SystemCard = memo(
	({ row, table, colLength }: { row: Row<SystemRecord>; table: TableType<SystemRecord>; colLength: number }) => {
		const system = row.original
		const { t } = useLingui()

		return useMemo(() => {
			return (
				<Card
					onMouseEnter={preloadSystemDetail}
					key={system.id}
					className={cn(
						"cursor-pointer hover:shadow-md transition-all bg-transparent w-full dark:border-border duration-200 relative",
						{
							"opacity-50": system.status === SystemStatus.Paused,
						}
					)}
				>
					<CardHeader className="py-1 ps-4 pe-2 bg-muted/30 border-b border-border/60">
						<div className="flex items-center gap-1 w-full overflow-hidden">
							<h3 className="text-primary/90 min-w-0 flex-1 gap-2.5 font-semibold">
								<div className="flex items-center gap-2.5 min-w-0 flex-1">
									<IndicatorDot system={system} />
									<span className="text-[.95em]/normal tracking-normal text-primary/90 truncate">{system.name}</span>
								</div>
							</h3>
							{table.getColumn("actions")?.getIsVisible() && (
								<div className="flex gap-1 shrink-0 relative z-10">
									<AlertButton system={system} />
									<ActionsButton system={system} />
								</div>
							)}
						</div>
					</CardHeader>
					<CardContent className="text-sm px-5 pt-3.5 pb-4">
						<div className="grid gap-2.5" style={{ gridTemplateColumns: "24px minmax(80px, max-content) minmax(0, 1fr)" }}>
							{table.getAllColumns().map((column) => {
								if (!column.getIsVisible() || column.id === "system" || column.id === "actions") return null
								const cell = row.getAllCells().find((cell) => cell.column.id === column.id)
								if (!cell) return null
								// @ts-expect-error
								const { Icon, name } = column.columnDef as ColumnDef<SystemRecord, unknown>
								return (
									<>
										<div key={`${column.id}-icon`} className="flex items-center">
											{column.id === "lastSeen" ? (
												<EyeIcon className="size-4 text-muted-foreground" />
											) : (
												Icon && <Icon className="size-4 text-muted-foreground" />
											)}
										</div>
										<div key={`${column.id}-label`} className="flex items-center text-muted-foreground pr-3">
											{name()}:
										</div>
										<div key={`${column.id}-value`} className="flex items-center min-w-0">
											{flexRender(cell.column.columnDef.cell, cell.getContext())}
										</div>
									</>
								)
							})}
						</div>
					</CardContent>
					<Link
						href={getPagePath($router, "system", { id: row.original.id })}
						className="inset-0 absolute w-full h-full"
					>
						<span className="sr-only">{row.original.name}</span>
					</Link>
				</Card>
			)
		}, [system, colLength, t])
	}
)
