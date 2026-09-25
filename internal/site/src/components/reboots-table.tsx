import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { getPagePath } from "@nanostores/router"
import {
	type Column,
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table"
import {
	ActivityIcon,
	ArrowUpDownIcon,
	BellIcon,
	DatabaseIcon,
	HourglassIcon,
	LoaderCircleIcon,
	MessageSquareTextIcon,
	PowerIcon,
	PowerOffIcon,
	ServerIcon,
} from "lucide-react"
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react"
import { $router, Link } from "@/components/router"
import { SystemsSelect } from "@/components/systems-select"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { pb } from "@/lib/api"
import { $allSystemsById } from "@/lib/stores"
import { cn, debounce, formatDuration, formatShortDate, getHostDisplayValue } from "@/lib/utils"
import type { SystemRebootRecord } from "@/types"

const pageSize = 50

const sourceLabels: Record<SystemRebootRecord["source"], () => string> = {
	uptime: () => t`Uptime`,
	eventlog: () => t`Windows event log`,
	journal: () => "systemd journal",
	wtmp: () => t`Login records`,
}

/** Start of a local day (yyyy-mm-dd), shifted by a number of days */
function localDay(value: string, addDays = 0) {
	const [year, month, day] = value.split("-").map(Number)
	return new Date(year, month - 1, day + addDays)
}

/** Record fields the hub sorts the sortable columns on */
const sortFields: Record<string, string> = {
	shutdown: "shutdown",
	boot: "boot",
	type: "unexpected",
	reason: "reason",
	source: "source",
}

function rebootColumns(userId: string): ColumnDef<SystemRebootRecord>[] {
	return [
		{
			// only shown on the page listing the reboots of all systems
			id: "system",
			meta: { name: () => t`System` },
			header: ({ column }) => <HeaderButton column={column} name={t`System`} Icon={ServerIcon} />,
			cell: ({ row }) => <SystemName id={row.original.system} />,
		},
		{
			id: "shutdown",
			meta: { name: () => t`Shutdown` },
			enableSorting: true,
			header: ({ column }) => <HeaderButton column={column} name={t`Shutdown`} Icon={PowerOffIcon} />,
			cell: ({ row }) =>
				row.original.shutdown ? formatShortDate(row.original.shutdown) : <span className="text-muted-foreground">-</span>,
		},
		{
			id: "boot",
			meta: { name: () => t`Boot` },
			enableSorting: true,
			header: ({ column }) => <HeaderButton column={column} name={t`Boot`} Icon={PowerIcon} />,
			cell: ({ row }) => formatShortDate(row.original.boot),
		},
		{
			id: "downtime",
			meta: { name: () => t`Downtime` },
			header: ({ column }) => <HeaderButton column={column} name={t`Downtime`} Icon={HourglassIcon} />,
			cell: ({ row }) =>
				formatDuration(row.original.shutdown, row.original.boot) || <span className="text-muted-foreground">-</span>,
		},
		{
			id: "type",
			meta: { name: () => t`Type` },
			enableSorting: true,
			header: ({ column }) => <HeaderButton column={column} name={t`Type`} Icon={ActivityIcon} />,
			cell: ({ row }) => <RebootType record={row.original} />,
		},
		{
			id: "reason",
			meta: { name: () => t`Reason`, grow: true },
			enableSorting: true,
			header: ({ column }) => <HeaderButton column={column} name={t`Reason`} Icon={MessageSquareTextIcon} />,
			cell: ({ row }) => <RebootReason record={row.original} />,
		},
		{
			id: "notification",
			meta: { name: () => t`Notification` },
			header: ({ column }) => <HeaderButton column={column} name={t`Notification`} Icon={BellIcon} />,
			cell: ({ row }) => <OutageAlertBadge alert={row.original.alerts?.[userId]} />,
		},
		{
			id: "source",
			meta: { name: () => t`Source` },
			enableSorting: true,
			header: ({ column }) => <HeaderButton column={column} name={t`Source`} Icon={DatabaseIcon} />,
			cell: ({ row }) => <span className="text-muted-foreground">{sourceLabels[row.original.source]?.()}</span>,
		},
	]
}

/**
 * Boots of the systems with the end of the run before them, newest first,
 * searchable by date and, without a systemId, by systems.
 */
export default function RebootsTable({ systemId }: { systemId?: string }) {
	const [from, setFrom] = useState("")
	const [to, setTo] = useState("")
	const [systemsFilter, setSystemsFilter] = useState<string[]>([])
	const [sorting, setSorting] = useState<SortingState>([{ id: "boot", desc: true }])
	const [records, setRecords] = useState<SystemRebootRecord[]>([])
	const [totals, setTotals] = useState({ all: 0, unexpected: 0 })
	const [page, setPage] = useState(1)
	const [hasMore, setHasMore] = useState(false)
	const [loading, setLoading] = useState(true)
	const [activeRecord, setActiveRecord] = useState<SystemRebootRecord | null>(null)
	const [sheetOpen, setSheetOpen] = useState(false)
	const { widths, onColumnResize, columnVisibility, onColumnVisibilityChange } = useTableLayout(
		systemId ? "system-reboots" : "reboots"
	)

	const systems = systemId ? [systemId] : systemsFilter
	const systemsKey = systems.join(",")

	// hub filter of the systems and dates chosen
	const filter = useMemo(() => {
		const conditions: string[] = []
		const params: Record<string, unknown> = {}
		if (systems.length) {
			conditions.push(`(${systems.map((_, i) => `system = {:system${i}}`).join(" || ")})`)
			systems.forEach((id, i) => {
				params[`system${i}`] = id
			})
		}
		if (from) {
			conditions.push("boot >= {:from}")
			params.from = localDay(from)
		}
		if (to) {
			conditions.push("boot < {:to}")
			params.to = localDay(to, 1)
		}
		return { conditions, params }
	}, [systemsKey, from, to])

	const sort = sorting
		.filter((s) => sortFields[s.id])
		.map((s) => `${s.desc ? "-" : ""}${sortFields[s.id]}`)
		.concat("-boot")
		.join(",")

	const load = useCallback(
		async (pageNumber: number) => {
			const { conditions, params } = filter
			const collection = pb.collection<SystemRebootRecord>("system_reboots")
			const where = (extra?: string) => {
				const all = extra ? [...conditions, extra] : conditions
				return all.length ? pb.filter(all.join(" && "), params) : undefined
			}
			setLoading(true)
			try {
				const [result, unexpected] = await Promise.all([
					// requestKey null: both requests run together, and in each table of the page
					collection.getList(pageNumber, pageSize, { filter: where(), sort, requestKey: null }),
					pageNumber === 1
						? collection.getList(1, 1, { filter: where("unexpected = true"), fields: "id", requestKey: null })
						: null,
				])
				setRecords((current) => (pageNumber === 1 ? result.items : [...current, ...result.items]))
				setHasMore(result.page < result.totalPages)
				setPage(pageNumber)
				if (unexpected) {
					setTotals({ all: result.totalItems, unexpected: unexpected.totalItems })
				}
			} catch (e) {
				console.error("get reboots", e)
			} finally {
				setLoading(false)
			}
		},
		[filter, sort]
	)

	useEffect(() => {
		load(1)
	}, [load])

	// show new reboots as they are recorded, once a burst of changes (history read from the logs) ends
	useEffect(() => {
		let unsubscribe: (() => void) | undefined
		const reload = debounce(() => load(1), 500)
		pb.collection<SystemRebootRecord>("system_reboots")
			.subscribe("*", ({ record }) => {
				if (!systems.length || systems.includes(record.system)) {
					reload()
				}
			})
			.then((fn) => {
				unsubscribe = fn
			})
		return () => unsubscribe?.()
	}, [systemsKey, load])

	const userId = pb.authStore.record?.id ?? ""
	const columns = useMemo(
		() => rebootColumns(userId).filter((column) => !systemId || column.id !== "system"),
		[userId, systemId]
	)

	const table = useReactTable({
		data: records,
		columns,
		getCoreRowModel: getCoreRowModel(),
		manualSorting: true,
		enableSortingRemoval: false,
		onSortingChange: setSorting,
		onColumnVisibilityChange,
		state: { sorting, columnVisibility },
		defaultColumn: {
			enableSorting: false,
		},
	})

	const openSheet = (record: SystemRebootRecord) => {
		setActiveRecord(record)
		setSheetOpen(true)
	}

	const hasFilters = from || to || systemsFilter.length > 0
	const unexpectedCount = totals.unexpected

	return (
		<Card className="@container w-full px-3 py-5 sm:py-6 sm:px-6">
			<CardHeader className="p-0 mb-3 sm:mb-4">
				<div className="grid md:flex gap-x-5 gap-y-3 w-full items-end">
					<div className="px-2 sm:px-1">
						<CardTitle className="mb-2">
							{systemId ? <Trans>Reboot history</Trans> : <Trans>All Reboots</Trans>}
						</CardTitle>
						<div className="text-sm text-muted-foreground flex items-center flex-wrap">
							<Trans>Total: {totals.all}</Trans>
							<Separator orientation="vertical" className="h-4 mx-2 bg-primary/40" />
							<Trans>Unexpected: {unexpectedCount}</Trans>
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-x-3 gap-y-2 md:ms-auto">
						<div className="flex items-center gap-2">
							<Label htmlFor={`reboots-from-${systemId ?? "all"}`}>
								<Trans>From</Trans>
							</Label>
							<Input
								id={`reboots-from-${systemId ?? "all"}`}
								type="date"
								value={from}
								max={to || undefined}
								onChange={(e) => setFrom(e.target.value)}
								className="w-40 tabular-nums"
							/>
						</div>
						<div className="flex items-center gap-2">
							<Label htmlFor={`reboots-to-${systemId ?? "all"}`}>
								<Trans>To</Trans>
							</Label>
							<Input
								id={`reboots-to-${systemId ?? "all"}`}
								type="date"
								value={to}
								min={from || undefined}
								onChange={(e) => setTo(e.target.value)}
								className="w-40 tabular-nums"
							/>
						</div>
						{!systemId && <SystemsSelect value={systemsFilter} onChange={setSystemsFilter} className="min-w-52 max-w-80" />}
						<ColumnsViewMenu table={table} />
						{hasFilters && (
							<Button
								variant="ghost"
								onClick={() => {
									setFrom("")
									setTo("")
									setSystemsFilter([])
								}}
							>
								<Trans>Clear</Trans>
							</Button>
						)}
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
										className="px-2 relative"
										key={header.id}
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
						{records.length ? (
							table.getRowModel().rows.map((row) => (
								<TableRow key={row.id} className="cursor-pointer" onClick={() => openSheet(row.original)}>
									{row.getVisibleCells().map((cell) => (
										<TableCell
											{...resizedAttr(widths[cell.column.id], cell.column.columnDef.meta?.grow)}
											key={cell.id}
											className="py-3 ps-4.5 tabular-nums"
											style={cellWidthStyle(widths[cell.column.id], cell.column.columnDef.meta?.grow)}
										>
											{flexRender(cell.column.columnDef.cell, cell.getContext())}
										</TableCell>
									))}
								</TableRow>
							))
						) : (
							<TableRow>
								<TableCell colSpan={table.getVisibleLeafColumns().length} className="h-37 text-center pointer-events-none">
									{loading ? (
										<LoaderCircleIcon className="size-4 animate-spin mx-auto text-muted-foreground" />
									) : (
										<Trans>No reboots recorded.</Trans>
									)}
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</table>
			</div>

			{hasMore && (
				<div className="flex justify-center mt-4">
					<Button variant="outline" onClick={() => load(page + 1)} disabled={loading}>
						{loading && <LoaderCircleIcon className="size-4 animate-spin" />}
						<Trans>Load more</Trans>
					</Button>
				</div>
			)}

			<RebootSheet record={activeRecord} open={sheetOpen} setOpen={setSheetOpen} userId={userId} />
		</Card>
	)
}

function HeaderButton({
	column,
	name,
	Icon,
}: {
	column: Column<SystemRebootRecord>
	name: string
	Icon: React.ElementType
}) {
	const isSorted = column.getIsSorted()
	if (!column.getCanSort()) {
		return (
			<span className="h-9 px-3 flex items-center gap-2 font-medium">
				<Icon className="size-4" />
				{name}
			</span>
		)
	}
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

function SystemName({ id }: { id: string }) {
	const system = useStore($allSystemsById)[id]
	return <span className="font-medium">{system?.name ?? id}</span>
}

/** Details of a reboot, opened by clicking its row */
function RebootSheet({
	record,
	open,
	setOpen,
	userId,
}: {
	record: SystemRebootRecord | null
	open: boolean
	setOpen: (open: boolean) => void
	userId: string
}) {
	const system = useStore($allSystemsById)[record?.system ?? ""]
	if (!record) {
		return null
	}
	const renderRow = (label: string, value: ReactNode) => (
		<tr key={label} className="border-b last:border-b-0">
			<td className="px-3 py-2 font-medium bg-muted dark:bg-muted/40 align-top w-40">{label}</td>
			<td className="px-3 py-2 break-words">{value || <span className="text-muted-foreground">-</span>}</td>
		</tr>
	)
	return (
		<Sheet open={open} onOpenChange={setOpen}>
			<SheetContent className="w-full sm:max-w-160 p-6 overflow-y-auto">
				<SheetHeader className="p-0">
					<SheetTitle>
						<Trans>Reboot details</Trans>
					</SheetTitle>
				</SheetHeader>
				<div className="border rounded-md">
					<table className="w-full text-sm">
						<tbody>
							{renderRow(
								t`System`,
								system ? (
									<Link
										href={getPagePath($router, "system", { id: system.id })}
										onClick={() => setOpen(false)}
										className="hover:underline"
									>
										{system.name}
									</Link>
								) : (
									record.system
								)
							)}
							{renderRow(t`Host / IP`, system && getHostDisplayValue(system))}
							{renderRow(t`Shutdown`, record.shutdown && formatShortDate(record.shutdown))}
							{renderRow(t`Boot`, formatShortDate(record.boot))}
							{renderRow(t`Downtime`, formatDuration(record.shutdown, record.boot))}
							{renderRow(t`Type`, <RebootType record={record} />)}
							{renderRow(t`Reason`, record.reason || <span className="text-muted-foreground">{t`(Unknown)`}</span>)}
							{renderRow(t`Initiated by`, record.user)}
							{renderRow(t`Notification`, <OutageAlertBadge alert={record.alerts?.[userId]} />)}
							{renderRow(t`Source`, sourceLabels[record.source]?.())}
							{renderRow(t`Recorded`, record.created && formatShortDate(record.created))}
						</tbody>
					</table>
				</div>
			</SheetContent>
		</Sheet>
	)
}

/** Reason recorded by the OS, and who requested the shutdown */
function RebootReason({ record }: { record: SystemRebootRecord }) {
	const title = [record.reason, record.user].filter(Boolean).join(" · ")
	return (
		<span className="block truncate" title={title || undefined}>
			{record.reason || <span className="text-muted-foreground">{t`(Unknown)`}</span>}
			{record.user && <span className="text-muted-foreground"> · {record.user}</span>}
		</span>
	)
}

/** Clean or unexpected shutdown; unknown when only the uptime is known */
function RebootType({ record }: { record: SystemRebootRecord }) {
	if (record.unexpected) {
		return (
			<Badge variant="warning">
				<Trans>Unexpected</Trans>
			</Badge>
		)
	}
	if (record.source === "uptime") {
		return <span className="text-muted-foreground">-</span>
	}
	return (
		<Badge variant="outline">
			<Trans context="Clean shutdown">Clean</Trans>
		</Badge>
	)
}

/** Whether the outage alert was sent, silenced by quiet hours, or not triggered */
function OutageAlertBadge({ alert }: { alert?: string }) {
	if (alert === "sent") {
		return (
			<Badge variant="danger">
				<Trans>Alert sent</Trans>
			</Badge>
		)
	}
	if (alert === "quiet") {
		return (
			<Badge variant="success">
				<Trans>Quiet hours</Trans>
			</Badge>
		)
	}
	return (
		<Badge variant="default">
			<Trans>No alert</Trans>
		</Badge>
	)
}
