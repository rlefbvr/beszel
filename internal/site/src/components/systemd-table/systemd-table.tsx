import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { getPagePath } from "@nanostores/router"
import {
	type ColumnFiltersState,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getSortedRowModel,
	type Row,
	type RowSelectionState,
	type SortingState,
	type Table as TableType,
	useReactTable,
	type VisibilityState,
} from "@tanstack/react-table"
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual"
import { LoaderCircleIcon } from "lucide-react"
import { listenKeys } from "nanostores"
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { getStatusColor, systemdTableCols } from "@/components/systemd-table/systemd-table-columns"
import { BulkStateAlertsButton, selectionColumn, targetRowId } from "@/components/alerts/bulk-state-alerts"
import { type ImportantTile, ImportantTargets } from "@/components/important-targets"
import { $router, Link } from "@/components/router"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { isReadOnlyUser, pb } from "@/lib/api"
import { Os, ServiceStatus, ServiceStatusLabels, type ServiceSubState, ServiceSubStateLabels } from "@/lib/enums"
import { $stateAlerts, importantTargets } from "@/lib/state-alerts"
import { $allSystemsById, $servicesInterval } from "@/lib/stores"
import { useSystemOs } from "@/lib/use-system-os"
import { cn, decimalString, formatBytes, getHostDisplayValue, secondsToString, useBrowserStorage } from "@/lib/utils"
import type { SystemdRecord, SystemdServiceDetails } from "@/types"
import { Separator } from "../ui/separator"

export default function SystemdTable({ systemId }: { systemId?: string }) {
	const loadTime = Date.now()
	const [data, setData] = useState<SystemdRecord[]>([])
	const [sorting, setSorting] = useBrowserStorage<SortingState>(
		`sort-sd-${systemId ? 1 : 0}`,
		[{ id: systemId ? "name" : "system", desc: false }],
		sessionStorage
	)
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
	const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
	const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
	const [globalFilter, setGlobalFilter] = useState("")

	// clear old data when systemId changes
	useEffect(() => {
		return setData([])
	}, [systemId])

	useEffect(() => {
		// time of the last services snapshot of each system (or of the last empty fetch)
		const lastUpdated: Record<string, number> = {}

		function fetchData(systemId?: string) {
			pb.collection<SystemdRecord>("systemd_services")
				.getList(0, 2000, {
					fields: "id,system,name,state,sub,cpu,cpuPeak,memory,memPeak,updated",
					filter: systemId ? pb.filter("system={:system}", { system: systemId }) : undefined,
				})
				.then(({ items }) => {
					// services are collected at an interval per system: keep the latest snapshot of
					// each one (rows of removed services stay until the retention sweep)
					const latest: Record<string, number> = {}
					for (const item of items) {
						latest[item.system] = Math.max(latest[item.system] ?? 0, item.updated)
					}
					Object.assign(lastUpdated, latest)
					if (systemId && !latest[systemId]) {
						lastUpdated[systemId] = Date.now()
					}
					const fresh = items.filter((item) => latest[item.system] - item.updated < 70_000)
					setData((curItems) =>
						systemId ? [...curItems.filter((item) => item.system !== systemId), ...fresh] : fresh
					)
				})
		}

		// don't fetch a system's services until its next collection is due (30s margin)
		const due = (id: string) => (lastUpdated[id] ?? 0) < Date.now() - ($servicesInterval.get() * 60 - 30) * 1000

		// initial load
		fetchData(systemId)

		// if no systemId, pull the services of each system after its updates
		if (!systemId) {
			return $allSystemsById.listen((_value, _oldValue, changedId) => {
				// exclude initial load of systems
				if (changedId && Date.now() - loadTime > 500 && due(changedId)) {
					fetchData(changedId)
				}
			})
		}

		// if systemId, fetch services after the system is updated
		return listenKeys($allSystemsById, [systemId], () => {
			if (due(systemId)) {
				fetchData(systemId)
			}
		})
	}, [systemId])

	const table = useReactTable({
		data,
		columns: useMemo(() => {
			const columns = systemdTableCols.filter((col) => (systemId ? col.id !== "system" : true))
			return isReadOnlyUser() ? columns : [selectionColumn<SystemdRecord>(), ...columns]
		}, [systemId]),
		getRowId: targetRowId,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		onSortingChange: setSorting,
		onColumnFiltersChange: setColumnFilters,
		onColumnVisibilityChange: setColumnVisibility,
		onRowSelectionChange: setRowSelection,
		defaultColumn: {
			sortUndefined: "last",
			size: 100,
			minSize: 0,
		},
		state: {
			sorting,
			columnFilters,
			columnVisibility,
			rowSelection,
			globalFilter,
		},
		onGlobalFilterChange: setGlobalFilter,
		globalFilterFn: (row, _columnId, filterValue) => {
			const service = row.original
			const systemName = $allSystemsById.get()[service.system]?.name ?? ""
			const name = service.name ?? ""
			const statusLabel = ServiceStatusLabels[service.state as ServiceStatus] ?? ""
			const subState = service.sub ?? ""
			const searchString = `${systemName} ${name} ${statusLabel} ${subState}`.toLowerCase()

			return (filterValue as string)
				.toLowerCase()
				.split(" ")
				.every((term) => searchString.includes(term))
		},
	})

	const rows = table.getRowModel().rows
	const selectedItems = table.getFilteredSelectedRowModel().rows.map((row) => row.original)
	const visibleColumns = table.getVisibleLeafColumns()

	const isWindows = useSystemOs(systemId ? $allSystemsById.get()[systemId] : undefined) === Os.Windows
	const servicesInterval = useStore($servicesInterval)
	const intervalLabel = secondsToString(servicesInterval * 60, "minute")

	const activeService = useRef<SystemdRecord | null>(null)
	const [sheetOpen, setSheetOpen] = useState(false)
	const openSheet = useCallback((service: SystemdRecord) => {
		activeService.current = service
		setSheetOpen(true)
	}, [])

	// services targeted by a state alert rule
	const stateAlerts = useStore($stateAlerts)
	const importantTiles = useMemo((): ImportantTile[] => {
		const systems = $allSystemsById.get()
		return importantTargets(stateAlerts, "service", data, systemId).map(({ item, name, system, triggered }) => ({
			key: `${system}/${name}`,
			name,
			systemName: systemId ? undefined : systems[system]?.name,
			dotClass: item ? getStatusColor(item.state) : "bg-zinc-400",
			status: item
				? `${ServiceStatusLabels[item.state] ?? ""} (${ServiceSubStateLabels[item.sub] ?? ""})`
				: t`Not reported`,
			triggered,
			onClick: item ? () => openSheet(item) : undefined,
			target: { kind: "service", system },
		}))
	}, [stateAlerts, data, systemId, openSheet])

	const statusTotals = useMemo(() => {
		const totals = [0, 0, 0, 0, 0, 0]
		for (const service of data) {
			totals[service.state]++
		}
		return totals
	}, [data])

	if (!data.length && !globalFilter) {
		return null
	}

	return (
		<Card className="@container w-full px-3 py-5 sm:py-6 sm:px-6">
			<CardHeader className="p-0 mb-3 sm:mb-4">
				<div className="grid md:flex gap-x-5 gap-y-3 w-full items-end">
					<div className="px-2 sm:px-1">
						<CardTitle className="mb-2">
							{!systemId ? (
								<Trans>All Services</Trans>
							) : isWindows ? (
								<Trans>Windows Services</Trans>
							) : (
								<Trans>Systemd Services</Trans>
							)}
						</CardTitle>
						<div className="text-sm text-muted-foreground flex items-center flex-wrap">
							<Trans>Total: {data.length}</Trans>
							<Separator orientation="vertical" className="h-4 mx-2 bg-primary/40" />
							<Trans>Failed: {statusTotals[ServiceStatus.Failed]}</Trans>
							<Separator orientation="vertical" className="h-4 mx-2 bg-primary/40" />
							<Trans>Updated every {intervalLabel}.</Trans>
						</div>
					</div>
					<div className="flex gap-2 ms-auto w-full md:w-auto">
						<Input
							placeholder={t`Filter...`}
							value={globalFilter}
							onChange={(e) => setGlobalFilter(e.target.value)}
							className="px-4 w-full max-w-full md:w-64"
						/>
						<BulkStateAlertsButton kind="service" items={selectedItems} />
					</div>
				</div>
			</CardHeader>
			<ImportantTargets title={<Trans>Important services</Trans>} tiles={importantTiles} />
			<div className="rounded-md">
				<AllSystemdTable
					table={table}
					rows={rows}
					colLength={visibleColumns.length}
					openSheet={openSheet}
					rowSelection={rowSelection}
				/>
			</div>
			<SystemdSheet sheetOpen={sheetOpen} setSheetOpen={setSheetOpen} activeService={activeService} />
		</Card>
	)
}

const AllSystemdTable = memo(function AllSystemdTable({
	table,
	rows,
	colLength,
	openSheet,
}: {
	table: TableType<SystemdRecord>
	rows: Row<SystemdRecord>[]
	colLength: number
	openSheet: (service: SystemdRecord) => void
	/** re-renders the rows when the selection changes */
	rowSelection: RowSelectionState
}) {
	// The virtualizer will need a reference to the scrollable container element
	const scrollRef = useRef<HTMLDivElement>(null)

	const virtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
		count: rows.length,
		estimateSize: () => 54,
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
			<div style={{ height: `${virtualizer.getTotalSize() + 48}px`, paddingTop, paddingBottom }}>
				<table className="text-sm w-full h-full text-nowrap">
					<SystemdTableHead table={table} />
					<TableBody>
						{rows.length ? (
							virtualRows.map((virtualRow) => {
								const row = rows[virtualRow.index]
								return (
									<SystemdTableRow
										key={row.id}
										row={row}
										virtualRow={virtualRow}
										openSheet={openSheet}
										selected={row.getIsSelected()}
									/>
								)
							})
						) : (
							<TableRow>
								<TableCell colSpan={colLength} className="h-37 text-center pointer-events-none">
									<Trans>No results.</Trans>
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</table>
			</div>
		</div>
	)
})

function SystemdSheet({
	sheetOpen,
	setSheetOpen,
	activeService,
}: {
	sheetOpen: boolean
	setSheetOpen: (open: boolean) => void
	activeService: React.RefObject<SystemdRecord | null>
}) {
	const service = activeService.current
	const [details, setDetails] = useState<SystemdServiceDetails | null>(null)
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		if (!sheetOpen || !service) {
			return
		}

		setError(null)

		let cancelled = false
		setDetails(null)
		setIsLoading(true)

		pb.send<{ details: SystemdServiceDetails }>("/api/beszel/systemd/info", {
			query: {
				system: service.system,
				service: service.name,
			},
		})
			.then(({ details }) => {
				if (cancelled) return
				if (details) {
					setDetails(details)
				} else {
					setDetails(null)
					setError(t`No results found.`)
				}
			})
			.catch((err) => {
				if (cancelled) return
				setError(err?.message ?? "Failed to load service details")
				setDetails(null)
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoading(false)
				}
			})

		return () => {
			cancelled = true
		}
	}, [sheetOpen, service])

	if (!service) return null

	const statusLabel = ServiceStatusLabels[service.state as ServiceStatus] ?? ""
	const subStateLabel = ServiceSubStateLabels[service.sub as ServiceSubState] ?? ""

	const notAvailable = <span className="text-muted-foreground">N/A</span>

	const formatMemory = (value?: number | null) => {
		if (value === undefined || value === null) {
			return value === null ? t`Unlimited` : undefined
		}
		const { value: convertedValue, unit } = formatBytes(value, false, undefined, false)
		const digits = convertedValue >= 10 ? 1 : 2
		return `${decimalString(convertedValue, digits)} ${unit}`
	}

	const formatCpuTime = (ns?: number) => {
		if (!ns) return undefined
		const seconds = ns / 1_000_000_000
		if (seconds >= 3600) {
			const hours = Math.floor(seconds / 3600)
			const minutes = Math.floor((seconds % 3600) / 60)
			const secs = Math.floor(seconds % 60)
			return [hours ? `${hours}h` : null, minutes ? `${minutes}m` : null, secs ? `${secs}s` : null]
				.filter(Boolean)
				.join(" ")
		}
		if (seconds >= 60) {
			const minutes = Math.floor(seconds / 60)
			const secs = Math.floor(seconds % 60)
			return `${minutes}m ${secs}s`
		}
		if (seconds >= 1) {
			return `${decimalString(seconds, 2)}s`
		}
		return `${decimalString(seconds * 1000, 2)}ms`
	}

	const formatTasks = (current?: number, max?: number) => {
		const hasCurrent = typeof current === "number" && current >= 0
		const hasMax = typeof max === "number" && max > 0 && max !== null
		if (!hasCurrent && !hasMax) {
			return undefined
		}
		return (
			<>
				{hasCurrent ? current : notAvailable}
				{hasMax && <span className="text-muted-foreground ms-1.5">{`(${t`limit`}: ${max})`}</span>}
				{max === null && (
					<span className="text-muted-foreground ms-1.5">{`(${t`limit`}: ${t`Unlimited`.toLowerCase()})`}</span>
				)}
			</>
		)
	}

	const formatTimestamp = (timestamp?: number) => {
		if (!timestamp) return undefined
		// systemd timestamps are in microseconds, convert to milliseconds for JavaScript Date
		const date = new Date(timestamp / 1000)
		if (Number.isNaN(date.getTime())) return undefined
		return date.toLocaleString()
	}

	const activeStateValue = (() => {
		const stateText = details?.ActiveState
			? details.SubState
				? `${details.ActiveState} (${details.SubState})`
				: details.ActiveState
			: subStateLabel
				? `${statusLabel} (${subStateLabel})`
				: statusLabel

		for (const [index, status] of ServiceStatusLabels.entries()) {
			if (details?.ActiveState?.toLowerCase() === status.toLowerCase()) {
				service.state = index as ServiceStatus
				break
			}
		}

		return (
			<div className="flex items-center gap-2">
				<div className={cn("w-2 h-2 rounded-full flex-shrink-0", getStatusColor(service.state))} />
				{stateText}
			</div>
		)
	})()

	// Windows agents report StartType instead of systemd unit file properties
	const isWindows = typeof details?.StartType === "string"
	const exitCodeValue = typeof details?.ExitCode === "number" && details.ExitCode !== 0 ? details.ExitCode : undefined
	const hostedServices = Array.isArray(details?.HostedServices) ? details.HostedServices : []

	const statusTextValue = details?.Result

	const cpuTime = formatCpuTime(details?.CPUUsageNSec)
	const tasks = formatTasks(details?.TasksCurrent, details?.TasksMax)
	const memoryCurrent = formatMemory(details?.MemoryCurrent)
	const memoryPeak = formatMemory(details?.MemoryPeak)
	const memoryLimit = formatMemory(details?.MemoryLimit)
	const restartsValue = typeof details?.NRestarts === "number" ? details.NRestarts : undefined
	const mainPidValue = typeof details?.MainPID === "number" && details.MainPID > 0 ? details.MainPID : undefined
	const execMainPidValue =
		typeof details?.ExecMainPID === "number" && details.ExecMainPID > 0 && details.ExecMainPID !== details?.MainPID
			? details.ExecMainPID
			: undefined
	const activeEnterTimestamp = formatTimestamp(details?.ActiveEnterTimestamp)
	const activeExitTimestamp = formatTimestamp(details?.ActiveExitTimestamp)
	const inactiveEnterTimestamp = formatTimestamp(details?.InactiveEnterTimestamp)
	const execMainStartTimestamp = undefined // Property not available in current systemd interface

	const renderRow = (key: string, label: ReactNode, value?: ReactNode, alwaysShow = false) => {
		if (!alwaysShow && (value === undefined || value === null || value === "")) {
			return null
		}
		return (
			<tr key={key} className="border-b last:border-b-0">
				<td className="px-3 py-2 font-medium bg-muted dark:bg-muted/40 align-top w-35">{label}</td>
				<td className="px-3 py-2">{value ?? notAvailable}</td>
			</tr>
		)
	}

	// system the service runs on
	const system = $allSystemsById.get()[service.system]

	const capitalize = (str: string) => `${str.charAt(0).toUpperCase()}${str.slice(1).toLowerCase()}`

	return (
		<Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
			<SheetContent className="w-full sm:max-w-220 p-6 overflow-y-auto">
				<SheetHeader className="p-0">
					<SheetTitle>
						<Trans>Service Details</Trans>
					</SheetTitle>
				</SheetHeader>
				<div className="grid gap-6">
					{isLoading && (
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<LoaderCircleIcon className="size-4 animate-spin" />
							<Trans>Loading...</Trans>
						</div>
					)}
					{error && (
						<Alert className="border-destructive/50 text-destructive dark:border-destructive/60 dark:text-destructive">
							<AlertTitle>
								<Trans>Error</Trans>
							</AlertTitle>
							<AlertDescription>{error}</AlertDescription>
						</Alert>
					)}

					<div>
						<div className="border rounded-md">
							<table className="w-full text-sm">
								<tbody>
									{system &&
										renderRow(
											"system",
											t`System`,
											<Link
												href={getPagePath($router, "system", { id: system.id })}
												onClick={() => setSheetOpen(false)}
												className="hover:underline"
											>
												{system.name}
											</Link>
										)}
									{system && renderRow("host", t`Host / IP`, getHostDisplayValue(system))}
									{renderRow("name", t`Name`, service.name, true)}
									{isWindows && renderRow("serviceName", t`Service name`, details?.ServiceName)}
									{renderRow(
										"description",
										t`Description`,
										(isWindows && details?.LongDescription) || details?.Description,
										true
									)}
									{renderRow("loadState", t`Load state`, details?.LoadState, !isWindows)}
									{isWindows
										? renderRow("startType", t`Start type`, details?.StartType, true)
										: renderRow(
												"bootState",
												t`Boot state`,
												<div className="flex items-center">
													{details?.UnitFileState}
													{details?.UnitFilePreset && (
														<span className="text-muted-foreground ms-1.5">(preset: {details?.UnitFilePreset})</span>
													)}
												</div>,
												true
											)}
									{renderRow("unitFile", t`Unit file`, details?.FragmentPath, !isWindows)}
									{isWindows && renderRow("execStart", t`Executable`, details?.ExecStart)}
									{isWindows && renderRow("user", t`Account`, details?.User)}
									{renderRow("active", t`Active state`, activeStateValue, true)}
									{renderRow("status", t`Status`, statusTextValue, true)}
									{renderRow("exitCode", t`Exit code`, exitCodeValue)}
									{renderRow(
										"documentation",
										t`Documentation`,
										Array.isArray(details?.Documentation) && details.Documentation.length > 0
											? details.Documentation.join(", ")
											: undefined
									)}
								</tbody>
							</table>
						</div>
					</div>

					{hostedServices.length > 0 && (
						<div>
							<h3 className="text-sm font-medium mb-3">
								<Trans>Hosted services</Trans>
							</h3>
							<div className="border rounded-md overflow-x-auto">
								<table className="w-full text-sm">
									<thead>
										<tr className="border-b bg-muted dark:bg-muted/40 text-start">
											<th className="px-3 py-2 font-medium text-start">
												<Trans>Service</Trans>
											</th>
											<th className="px-3 py-2 font-medium text-start">
												<Trans>Start type</Trans>
											</th>
											<th className="px-3 py-2 font-medium text-start">
												<Trans>State</Trans>
											</th>
										</tr>
									</thead>
									<tbody>
										{hostedServices.map((hosted) => (
											<tr key={hosted.ServiceName} className="border-b last:border-b-0">
												<td className="px-3 py-2" title={hosted.LongDescription || undefined}>
													<div>{hosted.DisplayName || hosted.ServiceName}</div>
													{hosted.DisplayName && hosted.DisplayName !== hosted.ServiceName && (
														<div className="text-muted-foreground text-xs">{hosted.ServiceName}</div>
													)}
												</td>
												<td className="px-3 py-2">{hosted.StartType}</td>
												<td className="px-3 py-2">{hosted.WindowsState}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					)}

					<div>
						<h3 className="text-sm font-medium mb-3">
							<Trans>Runtime Metrics</Trans>
						</h3>
						<div className="border rounded-md">
							<table className="w-full text-sm">
								<tbody>
									{renderRow("mainPid", t`Main PID`, mainPidValue, true)}
									{renderRow("execMainPid", t`Exec main PID`, execMainPidValue)}
									{renderRow("tasks", t`Tasks`, tasks, !isWindows)}
									{renderRow("cpuTime", t`CPU time`, cpuTime)}
									{renderRow("memory", t`Memory`, memoryCurrent, true)}
									{renderRow("memoryPeak", capitalize(t`Memory Peak`), memoryPeak)}
									{renderRow("memoryLimit", t`Memory limit`, memoryLimit)}
									{renderRow("restarts", t`Restarts`, restartsValue, !isWindows)}
								</tbody>
							</table>
						</div>
					</div>

					<div className="hidden has-[tr]:block">
						<h3 className="text-sm font-medium mb-3">
							<Trans>Relationships</Trans>
						</h3>
						<div className="border rounded-md">
							<table className="w-full text-sm">
								<tbody>
									{renderRow(
										"wants",
										t`Wants`,
										Array.isArray(details?.Wants) && details.Wants.length > 0 ? details.Wants.join(", ") : undefined
									)}
									{renderRow(
										"requires",
										t`Requires`,
										Array.isArray(details?.Requires) && details.Requires.length > 0
											? details.Requires.join(", ")
											: undefined
									)}
									{renderRow(
										"requiredBy",
										t`Required by`,
										Array.isArray(details?.RequiredBy) && details.RequiredBy.length > 0
											? details.RequiredBy.join(", ")
											: undefined
									)}
									{renderRow(
										"conflicts",
										t`Conflicts`,
										Array.isArray(details?.Conflicts) && details.Conflicts.length > 0
											? details.Conflicts.join(", ")
											: undefined
									)}
									{renderRow(
										"before",
										t`Before`,
										Array.isArray(details?.Before) && details.Before.length > 0 ? details.Before.join(", ") : undefined
									)}
									{renderRow(
										"after",
										t`After`,
										Array.isArray(details?.After) && details.After.length > 0 ? details.After.join(", ") : undefined
									)}
									{renderRow(
										"triggers",
										t`Triggers`,
										Array.isArray(details?.Triggers) && details.Triggers.length > 0
											? details.Triggers.join(", ")
											: undefined
									)}
									{renderRow(
										"triggeredBy",
										t`Triggered by`,
										Array.isArray(details?.TriggeredBy) && details.TriggeredBy.length > 0
											? details.TriggeredBy.join(", ")
											: undefined
									)}
								</tbody>
							</table>
						</div>
					</div>

					<div className="hidden has-[tr]:block">
						<h3 className="text-sm font-medium mb-3">
							<Trans>Lifecycle</Trans>
						</h3>
						<div className="border rounded-md">
							<table className="w-full text-sm">
								<tbody>
									{renderRow("activeSince", t`Became active`, activeEnterTimestamp)}
									{service.state !== ServiceStatus.Active &&
										renderRow("lastActive", t`Exited active`, activeExitTimestamp)}
									{renderRow("inactiveSince", t`Became inactive`, inactiveEnterTimestamp)}
									{renderRow("execMainStart", t`Process started`, execMainStartTimestamp)}
									{/* {renderRow("invocationId", t`Invocation ID`, details?.InvocationID)} */}
									{/* {renderRow("freezerState", t`Freezer State`, details?.FreezerState)} */}
								</tbody>
							</table>
						</div>
					</div>

					<div className="hidden has-[tr]:block">
						<h3 className="text-sm font-medium mb-3">
							<Trans>Capabilities</Trans>
						</h3>
						<div className="border rounded-md">
							<table className="w-full text-sm">
								<tbody>
									{renderRow(
										"canStart",
										t`Can start`,
										typeof details?.CanStart === "boolean" ? (details.CanStart ? t`Yes` : t`No`) : undefined
									)}
									{renderRow(
										"canStop",
										t`Can stop`,
										typeof details?.CanStop === "boolean" ? (details.CanStop ? t`Yes` : t`No`) : undefined
									)}
									{renderRow(
										"canReload",
										t`Can reload`,
										typeof details?.CanReload === "boolean" ? (details.CanReload ? t`Yes` : t`No`) : undefined
									)}
									{/* {renderRow("refuseManualStart", t`Refuse Manual Start`, details?.RefuseManualStart ? t`Yes` : t`No`)}
									{renderRow("refuseManualStop", t`Refuse Manual Stop`, details?.RefuseManualStop ? t`Yes` : t`No`)} */}
								</tbody>
							</table>
						</div>
					</div>
				</div>
			</SheetContent>
		</Sheet>
	)
}

function SystemdTableHead({ table }: { table: TableType<SystemdRecord> }) {
	return (
		<TableHeader className="sticky top-0 z-50 w-full border-b-2">
			{table.getHeaderGroups().map((headerGroup) => (
				<tr key={headerGroup.id}>
					{headerGroup.headers.map((header) => {
						return (
							<TableHead className="px-2" key={header.id}>
								{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
							</TableHead>
						)
					})}
				</tr>
			))}
		</TableHeader>
	)
}

const SystemdTableRow = memo(function SystemdTableRow({
	row,
	virtualRow,
	openSheet,
	selected,
}: {
	row: Row<SystemdRecord>
	virtualRow: VirtualItem
	openSheet: (service: SystemdRecord) => void
	selected: boolean
}) {
	return (
		<TableRow
			data-state={selected && "selected"}
			className="cursor-pointer transition-opacity"
			onClick={() => openSheet(row.original)}
		>
			{row.getVisibleCells().map((cell) => (
				<TableCell
					key={cell.id}
					className="py-0"
					style={{
						height: virtualRow.size,
					}}
				>
					{flexRender(cell.column.columnDef.cell, cell.getContext())}
				</TableCell>
			))}
		</TableRow>
	)
})
