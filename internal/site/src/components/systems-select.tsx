import { Plural, Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { ChevronDownIcon, ServerIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { $systems } from "@/lib/stores"
import { cn } from "@/lib/utils"

/** Choice of one or several systems; an empty selection means all systems */
export function SystemsSelect({
	value,
	onChange,
	className,
}: {
	value: string[]
	onChange: (value: string[]) => void
	className?: string
}) {
	const systems = useStore($systems)
	const selected = new Set(value)
	const [first] = value
	const firstName = systems.find((system) => system.id === first)?.name
	const count = value.length

	const toggle = (id: string, checked: boolean) => {
		const next = new Set(selected)
		checked ? next.add(id) : next.delete(id)
		onChange([...next])
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" className={cn("justify-between gap-2 font-normal", className)}>
					<span className="flex items-center gap-2 min-w-0">
						<ServerIcon className="size-4 shrink-0 opacity-70" />
						<span className="truncate">
							{count === 0 ? (
								<Trans>All Systems</Trans>
							) : count === 1 && firstName ? (
								firstName
							) : (
								<Plural value={count} one="# system" other="# systems" />
							)}
						</span>
					</span>
					<ChevronDownIcon className="size-4 shrink-0 opacity-50" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="max-h-80 overflow-y-auto min-w-52">
				<DropdownMenuCheckboxItem
					checked={count === 0}
					onSelect={(e) => e.preventDefault()}
					onCheckedChange={() => onChange([])}
				>
					<Trans>All Systems</Trans>
				</DropdownMenuCheckboxItem>
				<DropdownMenuSeparator />
				{systems.map((system) => (
					<DropdownMenuCheckboxItem
						key={system.id}
						checked={selected.has(system.id)}
						onSelect={(e) => e.preventDefault()}
						onCheckedChange={(checked) => toggle(system.id, checked === true)}
					>
						{system.name}
					</DropdownMenuCheckboxItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
