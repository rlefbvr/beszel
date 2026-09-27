import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { TableHead } from "@/components/ui/table"
import { cn } from "@/lib/utils"

/** Sort of a table: the key of its column and its direction */
export interface TableSort<K extends string> {
	key: K
	desc: boolean
}

/** Next sort after a click on a column: its other direction when already sorted on it */
export function nextSort<K extends string>(sort: TableSort<K>, key: K): TableSort<K> {
	return sort.key === key ? { key, desc: !sort.desc } : { key, desc: false }
}

/** Sortable header of a column, like the other tables: its icon, name and sort arrow */
export function SortableHead<K extends string>({
	sortKey,
	sort,
	onSort,
	Icon,
	className,
	children,
}: {
	sortKey: K
	sort: TableSort<K>
	onSort: (sort: TableSort<K>) => void
	Icon: React.ElementType
	className?: string
	children: ReactNode
}) {
	const active = sort.key === sortKey
	const Arrow = active ? (sort.desc ? ArrowDownIcon : ArrowUpIcon) : ArrowUpDownIcon
	return (
		<TableHead className={cn("px-2", className)}>
			<Button
				variant="ghost"
				className={cn("h-9 px-2 gap-2", active && "bg-accent/70 light:bg-accent text-accent-foreground/90")}
				onClick={() => onSort(nextSort(sort, sortKey))}
			>
				<Icon className="size-4" />
				{children}
				<Arrow className="size-4" />
			</Button>
		</TableHead>
	)
}
