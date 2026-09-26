import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { getPagePath } from "@nanostores/router"
import {
	type Column,
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	getSortedRowModel,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table"
import {
	ActivityIcon,
	ArrowUpDownIcon,
	ChevronDownIcon,
	ClockIcon,
	EyeIcon,
	FilterIcon,
	FolderCogIcon,
	FolderIcon,
	FolderOpenIcon,
	GaugeIcon,
	GlobeIcon,
	InfoIcon,
	LayersIcon,
	LayoutGridIcon,
	LayoutListIcon,
	ListIcon,
	NetworkIcon,
	PercentIcon,
	PlusIcon,
	Settings2Icon,
	TableIcon,
	TimerIcon,
	XIcon,
} from "lucide-react"
import { type ReactNode, useMemo, useState } from "react"
import { type OverflowTab, OverflowTabs } from "@/components/overflow-tabs"
import { $router, Link, navigate } from "@/components/router"
import {
	type Beat,
	BeatBars,
	CheckBadge,
	QualityBadge,
	SensorDot,
	useSensorsHeartbeats,
} from "@/components/sensors/sensor-badges"
import { HostBadge } from "@/components/sensors/host-links"
import { SensorBulkAdd } from "@/components/sensors/sensor-bulk-add"
import { SensorDialog } from "@/components/sensors/sensor-dialog"
import { ManageSensorGroupsDialog } from "@/components/systems-table/groups-dialog"
import { cellWidthStyle, ColumnResizer, headerWidthStyle, resizedAttr, useTableLayout } from "@/components/table-layout"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
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
import { Separator } from "@/components/ui/separator"
import { Sheet } from "@/components/ui/sheet"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { isReadOnlyUser, queueUserSettings } from "@/lib/api"

import { $checksBySensor, $sensorGroups, $sensors, $sensorsLoaded, checkName, sensorStatusLabel } from "@/lib/sensors"
import { $userSettings } from "@/lib/stores"
import { formatRelativeTime, useNow } from "@/lib/time"
import { cn, decimalString } from "@/lib/utils"
import type { SensorCheckRecord, SensorRecord, UserSettings } from "@/types"

const allTab = "all"
const ungroupedTab = "none"
const groupTab = (group: string) => (group ? `group:${group}` : ungroupedTab)

/** Fields of the grid tiles that can be hidden */
const gridFields = {
	host: () => t`Host / IP`,
	checks: () => t`Checks`,
	description: () => t`Information`,
	stats: () => t`Response and uptime`,
	heartbeat: () => t`Recent checks`,
}
type GridField = keyof typeof gridFields

/** Optional columns of the table, in the View menu */
const tableColumns = {
	host: () => t`Host / IP`,
	status: () => t`Status`,
	checks: () => t`Checks`,
	quality: () => t`Quality`,
	res: () => t`Response`,
	loss: () => t({ message: "Loss", context: "Packet loss" }),
	uptime: () => t`Uptime (24h)`,
	last_check: () => t`Last check`,
	group: () => t`Group`,
	description: () => t`Information`,
}
type TableLayoutState = ReturnType<typeof useTableLayout>

/** Orders of the sensors: by name, or by status or quality with the worst first */
type SensorSort = NonNullable<UserSettings["sensorsSort"]>

/** Rank of a status, the worst first: down, pending, up, paused */
const statusRank = (sensor: SensorRecord) =>
	(({ down: 0, pending: 1, up: 2, paused: 3 }) as Record<string, number>)[sensor.status] ?? 1

/** Rank of a quality, the worst first: bad (or down), degraded, good, unknown */
const qualityRank = (sensor: SensorRecord) =>
	sensor.status === "down" ? 0 : (({ bad: 0, degraded: 1, good: 2, "": 3 } as const)[sensor.quality] ?? 3)

function sortSensors(sensors: SensorRecord[], sort: SensorSort) {
	const rank = sort === "status" ? statusRank : sort === "quality" ? qualityRank : () => 0
	return sensors.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

function saveSetting<K extends keyof UserSettings>(key: K, value: UserSettings[K]) {
	$userSettings.setKey(key, value)
	queueUserSettings({ [key]: value })
}

/** Response time (ms) shown with a precision depending on its size */
export function formatMs(value: number | null | undefined) {
	if (value == null || !Number.isFinite(value)) {
		return "-"
	}
	return `${decimalString(value, value < 10 ? 2 : value < 100 ? 1 : 0)} ms`
}

/** Percentage shown with a precision depending on its size */
export function formatPercent(value: number | null | undefined) {
	if (value == null || !Number.isFinite(value)) {
		return "-"
	}
	return `${decimalString(value, value >= 99.95 || value === 0 ? 0 : value > 99 ? 2 : 1)}%`
}

/**
 * Network sensors checked by the hub: grid of small tiles or table, by group,
 * with their state, checks and recent probes.
 */
export default function SensorsBoard() {
	const sensors = useStore($sensors)
	const checksBySensor = useStore($checksBySensor)
	const groups = useStore($sensorGroups)
	const { loaded } = useStore($sensorsLoaded)
	const settings = useStore($userSettings)
	// the last 30 rounds of each sensor, like the bar of its page
	const heartbeats = useSensorsHeartbeats(30)
	const [filter, setFilter] = useState("")
	const [addOpen, setAddOpen] = useState(false)
	const [groupsOpen, setGroupsOpen] = useState(false)
	const [bulkOpen, setBulkOpen] = useState(false)
	const layout = useTableLayout("sensors")
	const view = settings.sensorsView ?? "grid"
	const byGroup = settings.sensorsByGroup ?? false
	const status = settings.sensorsStatus ?? "all"
	const hiddenFields = settings.sensorsHiddenFields ?? []
	const readOnly = isReadOnlyUser()

	const sort = settings.sensorsSort ?? "name"
	const all = useMemo(() => sortSensors(Object.values(sensors), sort), [sensors, sort])

	// filtered on the text and status, before the group tab
	const matching = useMemo(() => {
		const terms = filter.toLowerCase().split(" ").filter(Boolean)
		return all.filter((sensor) => {
			if (status !== "all" && sensor.status !== status) {
				return false
			}
			if (!terms.length) {
				return true
			}
			const checks = (checksBySensor[sensor.id] ?? []).map((check) => `${checkName(check)} ${check.port}`).join(" ")
			const text = `${sensor.name} ${sensor.host} ${sensor.group} ${sensor.description} ${checks}`.toLowerCase()
			return terms.every((term) => text.includes(term))
		})
	}, [all, filter, status, checksBySensor])

	const counts = useMemo(() => {
		const counts: Record<string, number> = { [allTab]: matching.length }
		for (const sensor of matching) {
			const tab = groupTab(sensor.group?.trim() ?? "")
			counts[tab] = (counts[tab] ?? 0) + 1
		}
		return counts
	}, [matching])
	const hasUngrouped = all.some((sensor) => !sensor.group?.trim())
	const storedTab = settings.sensorsGroupTab ?? allTab
	const tab =
		groups.some((group) => groupTab(group) === storedTab) || (storedTab === ungroupedTab && hasUngrouped)
			? storedTab
			: allTab
	const shown = tab === allTab ? matching : matching.filter((sensor) => groupTab(sensor.group?.trim() ?? "") === tab)

	const tabs = useMemo(() => {
		const count = (value: string) => (
			<span className="ms-1 rounded-full bg-muted-foreground/15 px-1.5 text-xs tabular-nums">{counts[value] ?? 0}</span>
		)
		const tabs: OverflowTab[] = [
			{
				value: allTab,
				label: (
					<>
						<LayersIcon className="size-3.5" />
						<Trans>All</Trans>
						{count(allTab)}
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
		if (hasUngrouped) {
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
	}, [groups, counts, hasUngrouped])

	const upCount = all.filter((sensor) => sensor.status === "up").length
	const downCount = all.filter((sensor) => sensor.status === "down").length
	const totalCount = all.length

	return (
		<Card className="@container w-full px-3 py-5 sm:py-6 sm:px-6">
			<CardHeader className="p-0 mb-3 sm:mb-4">
				<div className="grid md:flex gap-x-5 gap-y-3 w-full items-end">
					<div className="px-2 sm:px-1">
						<CardTitle className="mb-2">
							<Trans>Network sensors</Trans>
						</CardTitle>
						<div className="text-sm text-muted-foreground flex items-center flex-wrap">
							<Trans>Total: {totalCount}</Trans>
							<Separator orientation="vertical" className="h-4 mx-2 bg-primary/40" />
							<Trans>Up: {upCount}</Trans>
							<Separator orientation="vertical" className="h-4 mx-2 bg-primary/40" />
							<Trans>Down: {downCount}</Trans>
						</div>
					</div>
					<div className="flex gap-2 ms-auto w-full md:w-auto">
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
						<ViewMenu
							view={view}
							status={status}
							hiddenFields={hiddenFields}
							byGroup={byGroup}
							sort={sort}
							layout={layout}
							onManageGroups={readOnly ? undefined : () => setGroupsOpen(true)}
						/>
						{!readOnly && (
							<div className="flex shrink-0">
								<Button variant="outline" className="rounded-e-none gap-1.5" onClick={() => setAddOpen(true)}>
									<PlusIcon className="size-4" />
									<Trans>Add sensor</Trans>
								</Button>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button variant="outline" className="px-2 rounded-s-none border-s-0" aria-label={t`More`}>
											<ChevronDownIcon className="size-4" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuItem className="gap-2" onSelect={() => setBulkOpen(true)}>
											<ListIcon className="size-4" />
											<Trans>Bulk Add</Trans>
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</div>
						)}
					</div>
				</div>
			</CardHeader>

			{groups.length > 0 && (
				<div className="flex items-center gap-2 mb-3 sm:mb-4">
					<OverflowTabs
						tabs={tabs}
						value={tab}
						onChange={(value) => saveSetting("sensorsGroupTab", value)}
						className="min-w-0 flex-1"
						trailing={
							!readOnly && (
								<Button
									variant="ghost"
									size="icon"
									className="shrink-0"
									aria-label={t`Manage groups`}
									title={t`Manage groups`}
									onClick={() => setGroupsOpen(true)}
								>
									<FolderCogIcon className="size-4" />
								</Button>
							)
						}
					/>
				</div>
			)}

			{!all.length ? (
				<div className="rounded-md border border-dashed py-10 px-4 text-center text-sm text-muted-foreground grid gap-3 justify-items-center">
					<NetworkIcon className="size-8 opacity-60" />
					{loaded ? (
						<Trans>No sensor yet: add the hosts and ports that Beszel should check.</Trans>
					) : (
						<Trans>Loading...</Trans>
					)}
				</div>
			) : (
				<div className="grid gap-5">
					{(tab === allTab && byGroup ? sectionsByGroup(shown) : [{ group: null, sensors: shown }]).map(
						({ group, sensors: list }) => (
							<Section key={group ?? "all"} group={group} count={list.length}>
								{view === "grid" ? (
									<div className="grid gap-2.5 grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]">
										{list.map((sensor) => (
											<SensorTile
												key={sensor.id}
												sensor={sensor}
												checks={checksBySensor[sensor.id] ?? []}
												beats={heartbeats[sensor.id] ?? []}
												hidden={hiddenFields}
											/>
										))}
										{!list.length && (
											<p className="col-span-full py-8 text-center text-sm text-muted-foreground">
												<Trans>No results.</Trans>
											</p>
										)}
									</div>
								) : (
									<SensorsTable key={sort} sensors={list} checksBySensor={checksBySensor} layout={layout} sort={sort} />
								)}
							</Section>
						)
					)}
				</div>
			)}

			<Dialog open={addOpen} onOpenChange={setAddOpen}>
				{addOpen && <SensorDialog onDone={() => setAddOpen(false)} />}
			</Dialog>
			<Sheet open={bulkOpen} onOpenChange={setBulkOpen}>
				{bulkOpen && <SensorBulkAdd onDone={() => setBulkOpen(false)} />}
			</Sheet>
			<Dialog open={groupsOpen} onOpenChange={setGroupsOpen}>
				{groupsOpen && (
					<ManageSensorGroupsDialog
						initialGroup={groups.find((group) => groupTab(group) === tab)}
						onDone={() => setGroupsOpen(false)}
					/>
				)}
			</Dialog>
		</Card>
	)
}

/** Sensors of each group, the ones without group last */
function sectionsByGroup(sensors: SensorRecord[]) {
	const byGroup = new Map<string, SensorRecord[]>()
	for (const sensor of sensors) {
		const group = sensor.group?.trim() ?? ""
		byGroup.set(group, [...(byGroup.get(group) ?? []), sensor])
	}
	return [...byGroup.entries()]
		.sort(([a], [b]) => (!a ? 1 : !b ? -1 : a.localeCompare(b)))
		.map(([group, list]) => ({ group, sensors: list }))
}

/** Sensors of a group with its heading, or all the sensors without heading (group null) */
function Section({ group, count, children }: { group: string | null; count: number; children: ReactNode }) {
	if (group === null) {
		return <>{children}</>
	}
	const Icon = group ? FolderIcon : FolderOpenIcon
	return (
		<div className="grid gap-2.5">
			<div className="flex items-center gap-2 text-sm font-medium">
				<Icon className="size-4 text-muted-foreground" />
				{group || <Trans>No group</Trans>}
				<span className="rounded-full bg-muted-foreground/15 px-1.5 text-xs tabular-nums">{count}</span>
			</div>
			{children}
		</div>
	)
}

/** View options: layout, grouping, status filter, fields of the tiles or columns of the table, and groups */
function ViewMenu({
	view,
	status,
	hiddenFields,
	byGroup,
	sort,
	layout,
	onManageGroups,
}: {
	view: "grid" | "table"
	status: string
	hiddenFields: string[]
	byGroup: boolean
	sort: SensorSort
	layout: TableLayoutState
	onManageGroups?: () => void
}) {
	const toggleField = (field: GridField, visible: boolean) =>
		saveSetting(
			"sensorsHiddenFields",
			visible ? hiddenFields.filter((f) => f !== field) : [...hiddenFields.filter((f) => f !== field), field]
		)
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" className="shrink-0">
					<Settings2Icon className="me-1.5 size-4 opacity-80" />
					<Trans>View</Trans>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="max-h-[70dvh] overflow-y-auto">
				<div className="grid md:grid-cols-3 divide-y md:divide-y-0 md:divide-x">
					<div>
						<DropdownMenuLabel className="pt-2 px-3.5 flex items-center gap-2">
							<LayoutGridIcon className="size-4" />
							<Trans>Layout</Trans>
						</DropdownMenuLabel>
						<DropdownMenuSeparator />
						<DropdownMenuRadioGroup
							className="px-1 pb-1"
							value={view}
							onValueChange={(value) => saveSetting("sensorsView", value as "grid" | "table")}
						>
							<DropdownMenuRadioItem value="grid" onSelect={(e) => e.preventDefault()} className="gap-2">
								<LayoutGridIcon className="size-4" />
								<Trans>Grid</Trans>
							</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="table" onSelect={(e) => e.preventDefault()} className="gap-2">
								<LayoutListIcon className="size-4" />
								<Trans>Table</Trans>
							</DropdownMenuRadioItem>
						</DropdownMenuRadioGroup>
						<DropdownMenuSeparator />
						<div className="px-1 pb-1">
							<DropdownMenuCheckboxItem
								onSelect={(e) => e.preventDefault()}
								checked={byGroup}
								onCheckedChange={(value) => saveSetting("sensorsByGroup", !!value)}
							>
								<Trans>Show by group</Trans>
							</DropdownMenuCheckboxItem>
						</div>
						<DropdownMenuSeparator />
						<DropdownMenuLabel className="pt-2 px-3.5 flex items-center gap-2">
							<ArrowUpDownIcon className="size-4" />
							<Trans>Sort By</Trans>
						</DropdownMenuLabel>
						<DropdownMenuRadioGroup
							className="px-1 pb-1"
							value={sort}
							onValueChange={(value) => saveSetting("sensorsSort", value as SensorSort)}
						>
							<DropdownMenuRadioItem value="name" onSelect={(e) => e.preventDefault()}>
								<Trans>Name</Trans>
							</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="status" onSelect={(e) => e.preventDefault()}>
								<Trans>Status</Trans>
							</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="quality" onSelect={(e) => e.preventDefault()}>
								<Trans>Quality</Trans>
							</DropdownMenuRadioItem>
						</DropdownMenuRadioGroup>
						{onManageGroups && (
							<>
								<DropdownMenuSeparator />
								<DropdownMenuItem className="gap-2 mx-1 mb-1" onSelect={onManageGroups}>
									<FolderCogIcon className="size-4" />
									<Trans>Manage groups</Trans>
								</DropdownMenuItem>
							</>
						)}
					</div>
					<div>
						<DropdownMenuLabel className="pt-2 px-3.5 flex items-center gap-2">
							<FilterIcon className="size-4" />
							<Trans>Status</Trans>
						</DropdownMenuLabel>
						<DropdownMenuSeparator />
						<DropdownMenuRadioGroup
							className="px-1 pb-1"
							value={status}
							onValueChange={(value) => saveSetting("sensorsStatus", value as UserSettings["sensorsStatus"])}
						>
							<DropdownMenuRadioItem value="all" onSelect={(e) => e.preventDefault()}>
								<Trans>All</Trans>
							</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="up" onSelect={(e) => e.preventDefault()}>
								<Trans comment="Context: System is up">Up</Trans>
							</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="down" onSelect={(e) => e.preventDefault()}>
								<Trans comment="Context: System is down">Down</Trans>
							</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="paused" onSelect={(e) => e.preventDefault()}>
								<Trans>Paused</Trans>
							</DropdownMenuRadioItem>
						</DropdownMenuRadioGroup>
					</div>
					{view === "table" && (
						<div>
							<DropdownMenuLabel className="pt-2 px-3.5 flex items-center gap-2">
								<TableIcon className="size-4" />
								<Trans>Columns</Trans>
							</DropdownMenuLabel>
							<DropdownMenuSeparator />
							<div className="px-1.5 pb-1">
								{(Object.keys(tableColumns) as (keyof typeof tableColumns)[]).map((id) => (
									<DropdownMenuCheckboxItem
										key={id}
										onSelect={(e) => e.preventDefault()}
										checked={layout.columnVisibility[id] !== false}
										onCheckedChange={(value) =>
											layout.onColumnVisibilityChange((current) => ({ ...current, [id]: !!value }))
										}
									>
										{tableColumns[id]()}
									</DropdownMenuCheckboxItem>
								))}
							</div>
						</div>
					)}
					{view === "grid" && (
						<div>
							<DropdownMenuLabel className="pt-2 px-3.5 flex items-center gap-2">
								<EyeIcon className="size-4" />
								<Trans>Visible Fields</Trans>
							</DropdownMenuLabel>
							<DropdownMenuSeparator />
							<div className="px-1.5 pb-1">
								{(Object.keys(gridFields) as GridField[]).map((field) => (
									<DropdownMenuCheckboxItem
										key={field}
										onSelect={(e) => e.preventDefault()}
										checked={!hiddenFields.includes(field)}
										onCheckedChange={(value) => toggleField(field, !!value)}
									>
										{gridFields[field]()}
									</DropdownMenuCheckboxItem>
								))}
							</div>
						</div>
					)}
				</div>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

/** Small tile of a sensor: state, name, host, checks, response time, uptime and recent probes */
function SensorTile({
	sensor,
	checks,
	beats,
	hidden,
}: {
	sensor: SensorRecord
	checks: SensorCheckRecord[]
	beats: Beat[]
	hidden: string[]
}) {
	const show = (field: GridField) => !hidden.includes(field)
	return (
		<Link
			href={getPagePath($router, "sensor", { id: sensor.id })}
			className={cn(
				"group flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm transition-colors hover:bg-accent/40",
				sensor.status === "down" && "border-red-500/50",
				sensor.paused && "opacity-60"
			)}
		>
			<div className="flex items-center gap-2 min-w-0">
				<SensorDot sensor={sensor} />
				<span className="font-semibold truncate" title={sensor.name}>
					{sensor.name}
				</span>
				<HostBadge host={sensor.host} />
				{show("stats") && sensor.status !== "paused" && (
					<span className="ms-auto shrink-0 text-xs text-muted-foreground tabular-nums">
						{formatPercent(sensor.uptime)}
					</span>
				)}
			</div>
			{show("host") && (
				<div className="-mt-1 truncate text-xs text-muted-foreground" title={sensor.host}>
					{sensor.host}
				</div>
			)}
			{show("checks") && checks.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{checks.map((check) => (
						<CheckBadge key={check.id} check={check} />
					))}
				</div>
			)}
			{/* the line is kept when empty, so the tiles stay aligned */}
			{show("description") && (
				<div className="truncate text-xs leading-4 min-h-4 text-muted-foreground" title={sensor.description}>
					{sensor.description}
				</div>
			)}
			{/* the response, loss and recent checks at the bottom of the tile */}
			<div className="mt-auto grid gap-2">
				{show("stats") && sensor.status !== "paused" && (
					<div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
						<span className="flex items-center gap-1">
							<TimerIcon className="size-3.5" />
							{formatMs(sensor.res)}
						</span>
						<span className="flex items-center gap-1" title={t`Packet loss (%)`}>
							<PercentIcon className="size-3.5" />
							{formatPercent(sensor.loss)}
						</span>
					</div>
				)}
				{show("heartbeat") && <BeatBars beats={beats} className="h-3" />}
			</div>
		</Link>
	)
}

function HeaderButton({ column, name, Icon }: { column: Column<SensorRecord>; name: string; Icon: React.ElementType }) {
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

/** Sensors as a table with resizable and optional columns */
function SensorsTable({
	sensors,
	checksBySensor,
	layout,
	sort,
}: {
	sensors: SensorRecord[]
	checksBySensor: Record<string, SensorCheckRecord[]>
	layout: TableLayoutState
	/** order chosen in the View menu, the first sorting of the table */
	sort: SensorSort
}) {
	const [sorting, setSorting] = useState<SortingState>([{ id: sort, desc: false }])
	const { widths, onColumnResize, columnVisibility, onColumnVisibilityChange } = layout
	const now = useNow()
	const columns = useMemo<ColumnDef<SensorRecord>[]>(
		() => [
			{
				id: "name",
				meta: { name: () => t`Name` },
				accessorFn: (sensor) => sensor.name,
				sortingFn: "alphanumeric",
				header: ({ column }) => <HeaderButton column={column} name={t`Name`} Icon={NetworkIcon} />,
				cell: ({ row }) => (
					<span className="flex items-center gap-2 font-medium min-w-0">
						<SensorDot sensor={row.original} />
						<span className="truncate">{row.original.name}</span>
						<HostBadge host={row.original.host} />
					</span>
				),
			},
			{
				id: "host",
				meta: { name: () => t`Host / IP` },
				accessorFn: (sensor) => sensor.host,
				sortingFn: "alphanumeric",
				header: ({ column }) => <HeaderButton column={column} name={t`Host / IP`} Icon={GlobeIcon} />,
				cell: ({ row }) => <span>{row.original.host}</span>,
			},
			{
				id: "checks",
				meta: { name: () => t`Checks`, grow: true },
				accessorFn: (sensor) => (checksBySensor[sensor.id] ?? []).length,
				header: ({ column }) => <HeaderButton column={column} name={t`Checks`} Icon={ActivityIcon} />,
				cell: ({ row }) => (
					<span className="flex flex-wrap gap-1">
						{(checksBySensor[row.original.id] ?? []).map((check) => (
							<CheckBadge key={check.id} check={check} />
						))}
					</span>
				),
			},
			{
				id: "status",
				meta: { name: () => t`Status` },
				accessorFn: statusRank,
				header: ({ column }) => <HeaderButton column={column} name={t`Status`} Icon={ActivityIcon} />,
				cell: ({ row }) => (
					<span className="flex items-center gap-2 whitespace-nowrap">
						<SensorDot sensor={row.original} className="size-2" />
						{sensorStatusLabel(row.original.status)}
					</span>
				),
			},
			{
				id: "quality",
				meta: { name: () => t`Quality` },
				accessorFn: qualityRank,
				header: ({ column }) => <HeaderButton column={column} name={t`Quality`} Icon={GaugeIcon} />,
				cell: ({ row }) => <QualityBadge sensor={row.original} />,
			},
			{
				id: "res",
				meta: { name: () => t`Response` },
				accessorFn: (sensor) => sensor.res,
				header: ({ column }) => <HeaderButton column={column} name={t`Response`} Icon={TimerIcon} />,
				cell: ({ row }) => <span className="tabular-nums">{formatMs(row.original.res)}</span>,
			},
			{
				id: "loss",
				meta: { name: () => t({ message: "Loss", context: "Packet loss" }) },
				accessorFn: (sensor) => sensor.loss,
				header: ({ column }) => (
					<HeaderButton column={column} name={t({ message: "Loss", context: "Packet loss" })} Icon={PercentIcon} />
				),
				cell: ({ row }) => <span className="tabular-nums">{formatPercent(row.original.loss)}</span>,
			},
			{
				id: "uptime",
				meta: { name: () => t`Uptime (24h)` },
				accessorFn: (sensor) => sensor.uptime,
				header: ({ column }) => <HeaderButton column={column} name={t`Uptime (24h)`} Icon={ActivityIcon} />,
				cell: ({ row }) => <span className="tabular-nums">{formatPercent(row.original.uptime)}</span>,
			},
			{
				id: "last_check",
				meta: { name: () => t`Last check` },
				accessorFn: (sensor) => sensor.last_check,
				header: ({ column }) => <HeaderButton column={column} name={t`Last check`} Icon={ClockIcon} />,
				cell: ({ row }) =>
					row.original.last_check ? (
						<span className="text-muted-foreground">{formatRelativeTime(new Date(row.original.last_check), now)}</span>
					) : (
						<span className="text-muted-foreground">-</span>
					),
			},
			{
				id: "group",
				meta: { name: () => t`Group` },
				accessorFn: (sensor) => sensor.group,
				sortingFn: "alphanumeric",
				header: ({ column }) => <HeaderButton column={column} name={t`Group`} Icon={FolderIcon} />,
				cell: ({ row }) => <span className="text-muted-foreground">{row.original.group || "-"}</span>,
			},
			{
				id: "description",
				meta: { name: () => t`Information` },
				accessorFn: (sensor) => sensor.description,
				sortingFn: "alphanumeric",
				header: ({ column }) => <HeaderButton column={column} name={t`Information`} Icon={InfoIcon} />,
				cell: ({ row }) => <span className="text-muted-foreground truncate block">{row.original.description}</span>,
			},
		],
		[checksBySensor, now]
	)
	const table = useReactTable({
		data: sensors,
		columns,
		getRowId: (sensor) => sensor.id,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		onSortingChange: setSorting,
		onColumnVisibilityChange,
		state: { sorting, columnVisibility },
	})
	return (
		<div className="grid gap-2">
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
						{table.getRowModel().rows.map((row) => (
							<TableRow
								key={row.id}
								className={cn("cursor-pointer", row.original.paused && "opacity-60")}
								onClick={() => navigate(getPagePath($router, "sensor", { id: row.original.id }))}
							>
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
						))}
						{!sensors.length && (
							<TableRow>
								<TableCell colSpan={table.getVisibleLeafColumns().length} className="h-24 text-center">
									<Trans>No results.</Trans>
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</table>
			</div>
		</div>
	)
}
