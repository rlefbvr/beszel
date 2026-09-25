import { Trans, useLingui } from "@lingui/react/macro"
import type { RowData, Table, Updater, VisibilityState } from "@tanstack/react-table"
import { EyeIcon, Settings2Icon } from "lucide-react"
import { subscribeKeys } from "nanostores"
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { queueUserSettings } from "@/lib/api"
import { $userSettings } from "@/lib/stores"
import type { TableLayout } from "@/types"

declare module "@tanstack/react-table" {
	interface ColumnMeta<TData extends RowData, TValue> {
		/** name of the column in the view options; columns without a name can't be hidden */
		name?: () => string
		/** the column takes the remaining width of the table, its text truncated only when it doesn't fit */
		grow?: boolean
	}
}

/** Changes the width of a column: live while dragging, saved when done; undefined resets it */
export type ColumnResizeHandler = (columnId: string, width: number | undefined, done: boolean) => void

/** Column widths and hidden columns of a table, kept in the user settings under a key */
export function useTableLayout(key: string) {
	const [layout, setLayout] = useState<TableLayout>(() => $userSettings.get().tables?.[key] ?? {})

	// settings of a new device arrive after the first render
	useEffect(() => {
		let applied = false
		return subscribeKeys($userSettings, ["tables"], ({ tables }) => {
			if (!applied && tables?.[key]) {
				applied = true
				setLayout(tables[key])
			}
		})
	}, [key])

	const save = useCallback(
		(next: TableLayout) => {
			const tables = { ...$userSettings.get().tables, [key]: next }
			$userSettings.setKey("tables", tables)
			queueUserSettings({ tables })
		},
		[key]
	)

	const onColumnResize: ColumnResizeHandler = useCallback(
		(columnId, width, done) =>
			setLayout((current) => {
				const { [columnId]: _, ...others } = current.widths ?? {}
				const next = { ...current, widths: width === undefined ? others : { ...others, [columnId]: width } }
				if (done) {
					save(next)
				}
				return next
			}),
		[save]
	)

	const columnVisibility = useMemo<VisibilityState>(
		() => Object.fromEntries((layout.hidden ?? []).map((id) => [id, false])),
		[layout.hidden]
	)

	const onColumnVisibilityChange = useCallback(
		(updater: Updater<VisibilityState>) =>
			setLayout((current) => {
				const visibility = Object.fromEntries((current.hidden ?? []).map((id) => [id, false]))
				const nextVisibility = typeof updater === "function" ? updater(visibility) : updater
				const hidden = Object.keys(nextVisibility).filter((id) => nextVisibility[id] === false)
				const next = { ...current, hidden }
				save(next)
				return next
			}),
		[save]
	)

	return { widths: layout.widths ?? {}, onColumnResize, columnVisibility, onColumnVisibilityChange }
}

/** Style of a header cell with a chosen width */
export function headerWidthStyle(width?: number): CSSProperties | undefined {
	return width ? { width, minWidth: width, maxWidth: width } : undefined
}

/**
 * Style of a body cell: clipped to the chosen width, or for a growing column,
 * taking the remaining width without its text widening the table
 */
export function cellWidthStyle(width?: number, grow?: boolean): CSSProperties | undefined {
	if (width) {
		return { width, maxWidth: width, overflow: "hidden" }
	}
	// the minimum width keeps some text readable when the other columns fill the table
	return grow ? { width: "100%", maxWidth: 0, minWidth: "10rem" } : undefined
}

/** Marks a body cell of a resized or growing column: its content then uses the column width (index.css) */
export function resizedAttr(width?: number, grow?: boolean) {
	return width || grow ? { "data-resized": "" } : undefined
}

/** Drag handle on the edge of a column header; double click restores the automatic width */
export function ColumnResizer({ columnId, onColumnResize }: { columnId: string; onColumnResize: ColumnResizeHandler }) {
	const { t } = useLingui()
	const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
		e.preventDefault()
		e.stopPropagation()
		const header = e.currentTarget.parentElement
		if (!header) {
			return
		}
		const startX = e.clientX
		const startWidth = header.getBoundingClientRect().width
		// the handle is on the end side: dragging towards it widens the column
		const direction = getComputedStyle(header).direction === "rtl" ? -1 : 1
		const widthAt = (x: number) => Math.max(40, Math.round(startWidth + (x - startX) * direction))
		const onMove = (event: PointerEvent) => onColumnResize(columnId, widthAt(event.clientX), false)
		const onUp = (event: PointerEvent) => {
			window.removeEventListener("pointermove", onMove)
			window.removeEventListener("pointerup", onUp)
			onColumnResize(columnId, widthAt(event.clientX), true)
		}
		window.addEventListener("pointermove", onMove)
		window.addEventListener("pointerup", onUp)
	}
	// keyboard: arrows narrow or widen the column, Delete restores the automatic width
	const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
		const header = e.currentTarget.parentElement
		const step = { ArrowLeft: -16, ArrowRight: 16 }[e.key]
		if (step && header) {
			e.preventDefault()
			const direction = getComputedStyle(header).direction === "rtl" ? -1 : 1
			onColumnResize(columnId, Math.max(40, Math.round(header.getBoundingClientRect().width + step * direction)), true)
		} else if (e.key === "Delete") {
			onColumnResize(columnId, undefined, true)
		}
	}
	return (
		// biome-ignore lint/a11y/useSemanticElements: an <hr> can't be a focusable drag handle
		<div
			role="separator"
			tabIndex={0}
			aria-orientation="vertical"
			aria-valuenow={0}
			aria-label={t`Resize column`}
			title={t`Drag to resize, double click to reset`}
			className="absolute top-0 end-0 h-full w-1.5 cursor-col-resize select-none touch-none outline-none hover:bg-primary/30 focus-visible:bg-primary/50 active:bg-primary/50"
			onPointerDown={startResize}
			onClick={(e) => e.stopPropagation()}
			onKeyDown={onKeyDown}
			onDoubleClick={() => onColumnResize(columnId, undefined, true)}
		/>
	)
}

/** "View" button choosing the visible columns of a table, among the columns with a name */
export function ColumnsViewMenu<T>({ table }: { table: Table<T> }) {
	const columns = table.getAllLeafColumns().filter((column) => column.getCanHide() && column.columnDef.meta?.name)
	if (!columns.length) {
		return null
	}
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" className="shrink-0">
					<Settings2Icon className="me-1.5 size-4 opacity-80" />
					<Trans>View</Trans>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-48 max-h-80 overflow-y-auto">
				<DropdownMenuLabel className="pt-2 px-3.5 flex items-center gap-2">
					<EyeIcon className="size-4" />
					<Trans>Visible Fields</Trans>
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<div className="px-1.5 pb-1">
					{columns.map((column) => (
						<DropdownMenuCheckboxItem
							key={column.id}
							onSelect={(e) => e.preventDefault()}
							checked={column.getIsVisible()}
							onCheckedChange={(value) => column.toggleVisibility(!!value)}
						>
							{column.columnDef.meta?.name?.()}
						</DropdownMenuCheckboxItem>
					))}
				</div>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
