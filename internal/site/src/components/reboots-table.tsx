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
	type RowSelectionState,
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
	Trash2Icon,
} from "lucide-react"
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react"
import { selectionColumn } from "@/components/alerts/bulk-state-alerts"
import { type Period, PeriodSelect, periodRange } from "@/components/period-select"
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
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { isReadOnlyUser, pb } from "@/lib/api"
import { toast } from "@/components/ui/use-toast"
import { $allSystemsById } from "@/lib/stores"
import { formatDateTime } from "@/lib/time"
import { cn, debounce, formatDuration, getHostDisplayValue } from "@/lib/utils"
import type { SystemRebootRecord } from "@/types"

const sourceLabels: Record<SystemRebootRecord["source"], () => string> = {
	uptime: () => t`Uptime`,
	eventlog: () => t`Windows event log`,
	journal: () => "systemd journal",
	wtmp: () => t`Login records`,
}

/** Time of a date field in milliseconds, 0 when empty */
const timeOf = (value: string) => (value ? new Date(value).getTime() : 0)

/** Order of the reboot types: unknown (uptime only), clean, unexpected */
const typeRank = (record: SystemRebootRecord) => (record.unexpected ? 2 : record.source === "uptime" ? 0 : 1)

/** Order of the notification outcomes: none, quiet hours, sent */
const alertRank = { quiet: 1, sent: 2 } as Record<string, number>

function rebootColumns(userId: string): ColumnDef<SystemRebootRecord>[] {
	return [
		{
			// only shown on the page listing the reboots of all systems
			id: "system",
			meta: { name: () => t`System` },
			accessorFn: (record) => $allSystemsById.get()[record.system]?.name ?? record.system,
			sortingFn: "alphanumeric",
			header: ({ column }) => <HeaderButton column={column} name={t`System`} Icon={ServerIcon} />,
			cell: ({ row }) => <SystemName id={row.original.system} />,
		},
		{
			id: "shutdown",
			meta: { name: () => t`Shutdown` },
			accessorFn: (record) => timeOf(record.shutdown),
			header: ({ column }) => <HeaderButton column={column} name={t`Shutdown`} Icon={PowerOffIcon} />,
			cell: ({ row }) =>
				row.original.shutdown ? formatDateTime(row.original.shutdown) : <span className="text-muted-foreground">-</span>,
		},
		{
			id: "boot",
			meta: { name: () => t`Boot` },
			accessorFn: (record) => timeOf(record.boot),
			header: ({ column }) => <HeaderButton column={column} name={t`Boot`} Icon={PowerIcon} />,
			cell: ({ row }) => formatDateTime(row.original.boot),
		},
		{
			id: "downtime",
			meta: { name: () => t`Downtime` },
			accessorFn: (record) => (record.shutdown ? timeOf(record.boot) - timeOf(record.shutdown) : -1),
			header: ({ column }) => <HeaderButton column={column} name={t`Downtime`} Icon={HourglassIcon} />,
			cell: ({ row }) =>
				formatDuration(row.original.shutdown, row.original.boot) || <span className="text-muted-foreground">-</span>,
		},
		{
			id: "type",
			meta: { name: () => t`Type` },
			accessorFn: typeRank,
			header: ({ column }) => <HeaderButton column={column} name={t`Type`} Icon={ActivityIcon} />,
			cell: ({ row }) => <RebootType record={row.original} />,
		},
		{
			id: "reason",
			meta: { name: () => t`Reason`, grow: true },
			accessorFn: (record) => [record.reason, record.user].filter(Boolean).join(" "),
			sortingFn: "alphanumeric",
			header: ({ column }) => <HeaderButton column={column} name={t`Reason`} Icon={MessageSquareTextIcon} />,
			cell: ({ row }) => <RebootReason record={row.original} />,
		},
		{
			id: "notification",
			meta: { name: () => t`Notification` },
			accessorFn: (record) => alertRank[record.alerts?.[userId] ?? ""] ?? 0,
			header: ({ column }) => <HeaderButton column={column} name={t`Notification`} Icon={BellIcon} />,
			cell: ({ row }) => <OutageAlertBadge alert={row.original.alerts?.[userId]} />,
		},
		{
			id: "source",
			meta: { name: () => t`Source` },
			accessorFn: (record) => sourceLabels[record.source]?.() ?? record.source,
			sortingFn: "alphanumeric",
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
	const [period, setPeriod] = useState<Period>("all")
	const [from, setFrom] = useState("")
	const [to, setTo] = useState("")
	const [systemsFilter, setSystemsFilter] = useState<string[]>([])
	const [sorting, setSorting] = useState<SortingState>([{ id: "boot", desc: true }])
	const [records, setRecords] = useState<SystemRebootRecord[]>([])
	const [loading, setLoading] = useState(true)
	const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
	const [confirmDelete, setConfirmDelete] = useState(false)
	const [deleting, setDeleting] = useState(false)
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
		const range = periodRange(period, from, to)
		if (range.start) {
			conditions.push("boot >= {:from}")
			params.from = range.start
		}
		if (range.end) {
			conditions.push("boot < {:to}")
			params.to = range.end
		}
		return { conditions, params }
	}, [systemsKey, period, from, to])

	// all the reboots of the filters: they are sorted and selected in the page
	const load = useCallback(async () => {
		const { conditions, params } = filter
		setLoading(true)
		try {
			const items = await pb.collection<SystemRebootRecord>("system_reboots").getFullList({
				filter: conditions.length ? pb.filter(conditions.join(" && "), params) : undefined,
				sort: "-boot",
				batch: 500,
				// several tables can load at once (system page)
				requestKey: null,
			})
			setRecords(items)
			setRowSelection({})
		} catch (e) {
			console.error("get reboots", e)
		} finally {
			setLoading(false)
		}
	}, [filter])

	useEffect(() => {
		load()
	}, [load])

	// show new reboots as they are recorded, once a burst of changes (history read from the logs) ends
	useEffect(() => {
		let unsubscribe: (() => void) | undefined
		const reload = debounce(() => load(), 500)
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
	const canDelete = !isReadOnlyUser()
	const columns = useMemo(() => {
		const columns = rebootColumns(userId).filter((column) => !systemId || column.id !== "system")
		return canDelete ? [selectionColumn<SystemRebootRecord>(), ...columns] : columns
	}, [userId, systemId, canDelete])

	const table = useReactTable({
		data: records,
		columns,
		getRowId: (record) => record.id,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		enableSortingRemoval: false,
		onSortingChange: setSorting,
		onColumnVisibilityChange,
		onRowSelectionChange: setRowSelection,
		state: { sorting, columnVisibility, rowSelection },
	})
	const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id])

	// deletes the selected reboots, in batches of the hub limit
	const deleteSelected = async () => {
		setDeleting(true)
		try {
			for (let i = 0; i < selectedIds.length; i += 50) {
				const batch = pb.createBatch()
				for (const id of selectedIds.slice(i, i + 50)) {
					batch.collection("system_reboots").delete(id)
				}
				await batch.send()
			}
			setRowSelection({})
			load()
		} catch (e) {
			toast({ variant: "destructive", title: t`Error`, description: (e as Error).message })
		} finally {
			setDeleting(false)
			setConfirmDelete(false)
		}
	}

	const openSheet = (record: SystemRebootRecord) => {
		setActiveRecord(record)
		setSheetOpen(true)
	}

	const hasFilters = from || to || systemsFilter.length > 0
	const totalCount = records.length
	const unexpectedCount = records.filter((record) => record.unexpected).length
	const selectedCount = selectedIds.length

	return (
		<Card className="@container w-full px-3 py-5 sm:py-6 sm:px-6">
			<CardHeader className="p-0 mb-3 sm:mb-4">
				<div className="grid md:flex gap-x-5 gap-y-3 w-full items-end">
					<div className="px-2 sm:px-1">
						<CardTitle className="mb-2">
							{systemId ? <Trans>Reboot history</Trans> : <Trans>All Reboots</Trans>}
						</CardTitle>
						<div className="text-sm text-muted-foreground flex items-center flex-wrap">
							<Trans>Total: {totalCount}</Trans>
							<Separator orientation="vertical" className="h-4 mx-2 bg-primary/40" />
							<Trans>Unexpected: {unexpectedCount}</Trans>
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-x-3 gap-y-2 md:ms-auto">
						<PeriodSelect
							id={`reboots-${systemId ?? "all"}`}
							period={period}
							from={from}
							to={to}
							onPeriodChange={setPeriod}
							onFromChange={setFrom}
							onToChange={setTo}
							allowAll
						/>
						{!systemId && (
							<SystemsSelect value={systemsFilter} onChange={setSystemsFilter} className="min-w-52 max-w-80" />
						)}
						<ColumnsViewMenu table={table} />
						{selectedCount > 0 && (
							<Button variant="destructive" className="gap-2" onClick={() => setConfirmDelete(true)}>
								<Trash2Icon className="size-4" />
								<Trans>Delete ({selectedCount})</Trans>
							</Button>
						)}
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
										{header.column.id !== "select" && (
											<ColumnResizer columnId={header.column.id} onColumnResize={onColumnResize} />
										)}
									</TableHead>
								))}
							</tr>
						))}
					</TableHeader>
					<TableBody>
						{records.length ? (
							table.getRowModel().rows.map((row) => (
								<TableRow
									key={row.id}
									data-state={row.getIsSelected() && "selected"}
									className="cursor-pointer"
									onClick={() => openSheet(row.original)}
								>
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

			<AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							<Trans>Delete the selected reboots?</Trans>
						</AlertDialogTitle>
						<AlertDialogDescription>
							<Trans>This will permanently delete all selected records from the database.</Trans>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>
							<Trans>Cancel</Trans>
						</AlertDialogCancel>
						<AlertDialogAction
							className={cn(buttonVariants({ variant: "destructive" }))}
							disabled={deleting}
							onClick={(e) => {
								e.preventDefault()
								deleteSelected()
							}}
						>
							<Trans>Delete</Trans>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

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
							{renderRow(t`Shutdown`, record.shutdown && formatDateTime(record.shutdown))}
							{renderRow(t`Boot`, formatDateTime(record.boot))}
							{renderRow(t`Downtime`, formatDuration(record.shutdown, record.boot))}
							{renderRow(t`Type`, <RebootType record={record} />)}
							{renderRow(t`Reason`, record.reason || <span className="text-muted-foreground">{t`(Unknown)`}</span>)}
							{renderRow(t`Initiated by`, record.user)}
							{renderRow(t`Notification`, <OutageAlertBadge alert={record.alerts?.[userId]} />)}
							{renderRow(t`Source`, sourceLabels[record.source]?.())}
							{renderRow(t`Recorded`, record.created && formatDateTime(record.created))}
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
