import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import {
	type ColumnFiltersState,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	type PaginationState,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table"
import {
	ChevronLeftIcon,
	ChevronRightIcon,
	ChevronsLeftIcon,
	ChevronsRightIcon,
	DownloadIcon,
	LoaderCircleIcon,
	PenSquareIcon,
	Trash2Icon,
} from "lucide-react"
import { memo, useEffect, useState } from "react"
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
	cellWidthStyle,
	ColumnResizer,
	ColumnsViewMenu,
	headerWidthStyle,
	resizedAttr,
	useTableLayout,
} from "@/components/table-layout"
import { useToast } from "@/components/ui/use-toast"
import { alertInfo, stateAlertHistoryInfo } from "@/lib/alerts"
import { isAdmin, pb, saveAlertsRetention } from "@/lib/api"
import { $alertsRetention } from "@/lib/stores"
import { cn, formatDuration, formatShortDate, useBrowserStorage } from "@/lib/utils"
import type { AlertsHistoryRecord } from "@/types"
import { alertsHistoryColumns } from "../../alerts-history-columns"

const SectionIntro = memo(() => {
	const { count, days } = useStore($alertsRetention)
	return (
		<div>
			<h3 className="text-xl font-medium mb-2">
				<Trans>Alert History</Trans>
			</h3>
			<p className="text-sm text-muted-foreground leading-relaxed">
				{days ? (
					<Trans>View your alerts of the last {days} days.</Trans>
				) : (
					<Trans>View your {count} most recent alerts.</Trans>
				)}
			</p>
			{isAdmin() && <AlertsRetentionSetting />}
		</div>
	)
})

/**
 * Retention of the alert history for all users: a number of alerts per user,
 * or a number of days. Shown as text, edited after clicking Edit.
 */
function AlertsRetentionSetting() {
	const retention = useStore($alertsRetention)
	const { toast } = useToast()
	const [editing, setEditing] = useState(false)
	const [unit, setUnit] = useState<"count" | "days">("count")
	const [value, setValue] = useState("")
	const [saving, setSaving] = useState(false)
	const { count, days } = retention

	const startEditing = () => {
		setUnit(days ? "days" : "count")
		setValue(String(days || count))
		setEditing(true)
	}

	const number = Number(value)
	const valid = Number.isInteger(number) && (unit === "days" ? number >= 1 && number <= 3650 : number >= 10 && number <= 100000)

	const save = async (e: React.FormEvent) => {
		e.preventDefault()
		setSaving(true)
		try {
			await (unit === "days" ? saveAlertsRetention(count, number) : saveAlertsRetention(number, 0))
			toast({ title: t`Settings saved` })
			setEditing(false)
		} catch (err) {
			toast({ variant: "destructive", title: t`Failed to save settings`, description: (err as Error).message })
		} finally {
			setSaving(false)
		}
	}

	if (!editing) {
		return (
			<div className="flex flex-wrap items-center gap-3 mt-3 text-sm">
				<span>
					{days ? (
						<Trans>Retention: the alerts of the last {days} days</Trans>
					) : (
						<Trans>Retention: the last {count} alerts of each user</Trans>
					)}
				</span>
				<Button variant="outline" size="sm" className="h-8 gap-2" onClick={startEditing}>
					<PenSquareIcon className="size-4" />
					<Trans>Edit</Trans>
				</Button>
			</div>
		)
	}

	return (
		<form onSubmit={save} className="flex flex-wrap items-center gap-2 mt-3 text-sm">
			<Label htmlFor="alerts-retention">
				<Trans>Keep</Trans>
			</Label>
			<Input
				id="alerts-retention"
				type="number"
				min={unit === "days" ? 1 : 10}
				max={unit === "days" ? 3650 : 100000}
				value={value}
				onChange={(e) => setValue(e.target.value)}
				className="h-9 w-28 tabular-nums"
				autoFocus
			/>
			<Tabs value={unit} onValueChange={(v) => setUnit(v as "count" | "days")}>
				<TabsList className="h-9" aria-label={t`Retention unit`}>
					<TabsTrigger value="count">
						<Trans>alerts per user</Trans>
					</TabsTrigger>
					<TabsTrigger value="days">
						<Trans>days of alerts</Trans>
					</TabsTrigger>
				</TabsList>
			</Tabs>
			<Button type="submit" size="sm" className="h-9 gap-2" disabled={!valid || saving}>
				{saving && <LoaderCircleIcon className="size-4 animate-spin" />}
				<Trans>Save</Trans>
			</Button>
			<Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => setEditing(false)}>
				<Trans>Cancel</Trans>
			</Button>
		</form>
	)
}

export default function AlertsHistoryDataTable() {
	const [data, setData] = useState<AlertsHistoryRecord[]>([])
	const [sorting, setSorting] = useState<SortingState>([])
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
	const { widths, onColumnResize, columnVisibility, onColumnVisibilityChange } = useTableLayout("alerts-history")
	const [rowSelection, setRowSelection] = useState({})
	const [globalFilter, setGlobalFilter] = useState("")
	const { toast } = useToast()
	const [deleteOpen, setDeleteDialogOpen] = useState(false)
	
	// Store pagination preference in local storage
	const [pagination, setPagination] = useBrowserStorage<PaginationState>("ah-pagination", {
		pageIndex: 0,
		pageSize: 10,
	})

	useEffect(() => {
		let unsubscribe: (() => void) | undefined
		const pbOptions = {
			expand: "system",
			fields: "id,name,monitor_name,value,state,created,resolved,expand.system.name",
		}
		// Initial load: the whole history kept by the retention setting
		pb.collection<AlertsHistoryRecord>("alerts_history")
			.getFullList({
				...pbOptions,
				sort: "-created",
				batch: 500,
			})
			.then((items) => setData(items))

		// Subscribe to changes
		;(async () => {
			unsubscribe = await pb.collection("alerts_history").subscribe(
				"*",
				(e) => {
					if (e.action === "create") {
						setData((current) => [e.record as AlertsHistoryRecord, ...current])
					}
					if (e.action === "update") {
						setData((current) => current.map((r) => (r.id === e.record.id ? (e.record as AlertsHistoryRecord) : r)))
					}
					if (e.action === "delete") {
						setData((current) => current.filter((r) => r.id !== e.record.id))
					}
				},
				pbOptions
			)
		})()
		// Unsubscribe on unmount
		return () => unsubscribe?.()
	}, [])

	const table = useReactTable({
		data,
		columns: [
			{
				id: "select",
				header: ({ table }) => (
					<Checkbox
						className="ms-2"
						checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")}
						onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
						aria-label="Select all"
					/>
				),
				cell: ({ row }) => (
					<Checkbox
						checked={row.getIsSelected()}
						onCheckedChange={(value) => row.toggleSelected(!!value)}
						aria-label="Select row"
					/>
				),
				enableSorting: false,
				enableHiding: false,
			},
			...alertsHistoryColumns,
		],
		getCoreRowModel: getCoreRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		onSortingChange: setSorting,
		onColumnFiltersChange: setColumnFilters,
		onColumnVisibilityChange,
		onRowSelectionChange: setRowSelection,
		onPaginationChange: setPagination,
		state: {
			sorting,
			columnFilters,
			columnVisibility,
			rowSelection,
			globalFilter,
			pagination,
		},
		onGlobalFilterChange: setGlobalFilter,
		globalFilterFn: (row, _columnId, filterValue) => {
			const system = row.original.expand?.system?.name ?? ""
			const name = row.getValue("name") ?? ""
			const created = row.getValue("created") ?? ""
			const search = String(filterValue).toLowerCase()
			return (
				system.toLowerCase().includes(search) ||
				(name as string).toLowerCase().includes(search) ||
				(created as string).toLowerCase().includes(search)
			)
		},
	})

	// Bulk delete handler
	const handleBulkDelete = async () => {
		setDeleteDialogOpen(false)
		const selectedIds = table.getSelectedRowModel().rows.map((row) => row.original.id)
		try {
			let batch = pb.createBatch()
			let inBatch = 0
			for (const id of selectedIds) {
				batch.collection("alerts_history").delete(id)
				inBatch++
				if (inBatch > 20) {
					await batch.send()
					batch = pb.createBatch()
					inBatch = 0
				}
			}
			inBatch && (await batch.send())
			table.resetRowSelection()
		} catch (e) {
			toast({
				variant: "destructive",
				title: t`Error`,
				description: `Failed to delete records.`,
			})
		}
	}

	// Export to CSV handler
	const handleExportCSV = () => {
		const selectedRows = table.getSelectedRowModel().rows
		if (!selectedRows.length) return
		const cells: Record<string, (record: AlertsHistoryRecord) => string> = {
			system: (record) => record.expand?.system?.name || record.system,
			name: (record) => [(alertInfo[record.name] ?? stateAlertHistoryInfo[record.name])?.name() || record.name, record.monitor_name].filter(Boolean).join(": "),
			value: (record) => record.value + (alertInfo[record.name]?.unit ?? ""),
			state: (record) => (record.resolved ? t`Resolved` : t`Active`),
			created: (record) => formatShortDate(record.created),
			resolved: (record) => (record.resolved ? formatShortDate(record.resolved) : ""),
			duration: (record) => (record.resolved ? formatDuration(record.created, record.resolved) : ""),
		}
		const csvRows = [Object.keys(cells).join(",")]
		for (const row of selectedRows) {
			const r = row.original
			csvRows.push(
				Object.values(cells)
					.map((val) => val(r))
					.join(",")
			)
		}
		const blob = new Blob([csvRows.join("\n")], { type: "text/csv" })
		const url = URL.createObjectURL(blob)
		const a = document.createElement("a")
		a.href = url
		a.download = "alerts_history.csv"
		a.click()
		URL.revokeObjectURL(url)
	}

	return (
		<div className="@container w-full">
			<div className="@3xl:flex items-end mb-4 gap-4">
				<SectionIntro />
				<div className="flex items-center gap-2 ms-auto mt-3 @3xl:mt-0">
					{table.getFilteredSelectedRowModel().rows.length > 0 && (
						<div className="fixed bottom-0 left-0 w-full p-4 grid grid-cols-2 items-center gap-4 z-50 backdrop-blur-md shrink-0 @lg:static @lg:p-0 @lg:w-auto @lg:gap-3">
							<AlertDialog open={deleteOpen} onOpenChange={(open) => setDeleteDialogOpen(open)}>
								<AlertDialogTrigger asChild>
									<Button variant="destructive" className="h-9 shrink-0">
										<Trash2Icon className="size-4 shrink-0" />
										<span className="ms-1">
											<Trans>Delete</Trans>
										</span>
									</Button>
								</AlertDialogTrigger>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>
											<Trans>Are you sure?</Trans>
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
											onClick={handleBulkDelete}
										>
											<Trans>Continue</Trans>
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
							<Button variant="outline" className="h-10" onClick={handleExportCSV}>
								<DownloadIcon className="size-4" />
								<span className="ms-1">
									<Trans>Export</Trans>
								</span>
							</Button>
						</div>
					)}
					<Input
						placeholder={t`Filter...`}
						value={globalFilter}
						onChange={(e) => setGlobalFilter(e.target.value)}
						className="px-4 w-full max-w-full @3xl:w-64"
					/>
					<ColumnsViewMenu table={table} />
				</div>
			</div>
			<div className="rounded-md border overflow-x-auto whitespace-nowrap">
				<Table>
					<TableHeader>
						{table.getHeaderGroups().map((headerGroup) => (
							<tr key={headerGroup.id} className="border-border/50">
								{headerGroup.headers.map((header) => (
									<TableHead
										className="px-2 relative"
										key={header.id}
										style={headerWidthStyle(widths[header.column.id])}
									>
										{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
										{header.column.id !== "select" && (
											<ColumnResizer columnId={header.column.id} onColumnResize={onColumnResize} />
										)}
									</TableHead>
								))}
							</tr>
						))}
					</TableHeader>
					<TableBody>
						{table.getRowModel().rows.length ? (
							table.getRowModel().rows.map((row) => (
								<TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
									{row.getVisibleCells().map((cell) => (
										<TableCell
											key={cell.id}
											className="py-3"
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
								<TableCell colSpan={table.getAllColumns().length} className="h-24 text-center">
									<Trans>No results.</Trans>
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>
			<div className="flex items-center justify-between ps-1 tabular-nums">
				<div className="text-muted-foreground hidden flex-1 text-sm lg:flex">
					<Trans>
						{table.getFilteredSelectedRowModel().rows.length} of {table.getFilteredRowModel().rows.length} row(s)
						selected.
					</Trans>
				</div>
				<div className="flex w-full items-center gap-8 lg:w-fit my-3">
					<div className="hidden items-center gap-2 lg:flex">
						<Label htmlFor="rows-per-page" className="text-sm font-medium">
							<Trans>Rows per page</Trans>
						</Label>
						<Select
							value={`${table.getState().pagination.pageSize}`}
							onValueChange={(value) => {
								table.setPageSize(Number(value));
							}}
						>
							<SelectTrigger className="w-18" id="rows-per-page">
								<SelectValue placeholder={table.getState().pagination.pageSize} />
							</SelectTrigger>
							<SelectContent side="top">
								{[10, 20, 50, 100, 200].map((pageSize) => (
									<SelectItem key={pageSize} value={`${pageSize}`}>
										{pageSize}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="flex w-fit items-center justify-center text-sm font-medium">
						<Trans>
							Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
						</Trans>
					</div>
					<div className="ms-auto flex items-center gap-2 lg:ms-0">
						<Button
							variant="outline"
							className="hidden size-9 p-0 lg:flex"
							onClick={() => table.setPageIndex(0)}
							disabled={!table.getCanPreviousPage()}
						>
							<span className="sr-only">Go to first page</span>
							<ChevronsLeftIcon className="size-5" />
						</Button>
						<Button
							variant="outline"
							className="size-9"
							size="icon"
							onClick={() => table.previousPage()}
							disabled={!table.getCanPreviousPage()}
						>
							<span className="sr-only">Go to previous page</span>
							<ChevronLeftIcon className="size-5" />
						</Button>
						<Button
							variant="outline"
							className="size-9"
							size="icon"
							onClick={() => table.nextPage()}
							disabled={!table.getCanNextPage()}
						>
							<span className="sr-only">Go to next page</span>
							<ChevronRightIcon className="size-5" />
						</Button>
						<Button
							variant="outline"
							className="hidden size-9 lg:flex"
							size="icon"
							onClick={() => table.setPageIndex(table.getPageCount() - 1)}
							disabled={!table.getCanNextPage()}
						>
							<span className="sr-only">Go to last page</span>
							<ChevronsRightIcon className="size-5" />
						</Button>
					</div>
				</div>
			</div>
		</div>
	)
}
