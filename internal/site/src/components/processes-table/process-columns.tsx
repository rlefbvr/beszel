import { t } from "@lingui/core/macro"
import { useStore } from "@nanostores/react"
import type { Column, ColumnDef } from "@tanstack/react-table"
import {
	ActivityIcon,
	ArrowDownToLineIcon,
	ArrowUpDownIcon,
	ArrowUpFromLineIcon,
	CalendarClockIcon,
	CpuIcon,
	HashIcon,
	MemoryStickIcon,
	NetworkIcon,
	ServerIcon,
	SquareTerminalIcon,
	UserIcon,
	WaypointsIcon,
} from "lucide-react"
import { useMemo } from "react"
import { Button } from "@/components/ui/button"
import { $allSystemsById } from "@/lib/stores"
import { formatDateTime } from "@/lib/time"
import { cn } from "@/lib/utils"
import { formatRate, formatSize, percent, type ProcessRow, usageClass } from "./process-dialog"

/** Header of a sortable column: icon, name and sort arrow, like the other tables */
export function HeaderButton<T>({ column, name, Icon }: { column: Column<T>; name: string; Icon: React.ElementType }) {
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

export function useProcessColumns(withSystem = false): ColumnDef<ProcessRow>[] {
	const systems = useStore($allSystemsById)
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
				id: "system",
				meta: { name: () => t`System` },
				accessorFn: (row) => systems[row.system]?.name ?? row.system,
				header: ({ column }) => <HeaderButton column={column} name={t`System`} Icon={ServerIcon} />,
				cell: ({ getValue }) => <span className="ms-1.5 block max-w-40 truncate font-medium">{getValue() as string}</span>,
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
		return withSystem ? columns : columns.filter((column) => column.id !== "system")
	}, [withSystem, systems])
}
