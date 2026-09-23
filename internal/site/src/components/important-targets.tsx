import { Trans } from "@lingui/react/macro"
import { BellRingIcon } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface ImportantTile {
	key: string
	name: string
	/** shown on pages listing several systems */
	systemName?: string
	/** tailwind background class of the status dot */
	dotClass: string
	status: ReactNode
	/** a rule for this target currently has an open incident */
	triggered: boolean
	onClick?: () => void
}

/** Services or containers targeted by a state alert rule, shown above their table */
export function ImportantTargets({ title, tiles }: { title: ReactNode; tiles: ImportantTile[] }) {
	if (tiles.length === 0) {
		return null
	}
	return (
		<div className="mb-4 grid gap-2">
			<div className="flex items-center gap-2 px-1 text-sm font-medium">
				<BellRingIcon className="size-3.5 text-muted-foreground" />
				{title}
				<span className="text-muted-foreground font-normal">
					<Trans>With a state alert rule</Trans>
				</span>
			</div>
			<div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
				{tiles.map((tile) => (
					<button
						type="button"
						key={tile.key}
						onClick={tile.onClick}
						disabled={!tile.onClick}
						className={cn(
							"text-start rounded-md border px-3 py-2.5 grid gap-1 min-w-0 transition-colors",
							tile.onClick ? "hover:bg-muted/50 cursor-pointer" : "cursor-default",
							tile.triggered ? "border-red-500/50 bg-red-500/5" : "bg-muted/20"
						)}
					>
						<span className="flex items-center gap-2 min-w-0">
							<span className={cn("size-2 shrink-0 rounded-full", tile.dotClass)} />
							<span className="truncate font-medium text-sm" title={tile.name}>
								{tile.name}
							</span>
						</span>
						<span className="flex items-center gap-1.5 min-w-0 text-xs text-muted-foreground">
							<span className="truncate">{tile.status}</span>
							{tile.systemName && (
								<>
									<span aria-hidden>·</span>
									<span className="truncate">{tile.systemName}</span>
								</>
							)}
						</span>
					</button>
				))}
			</div>
		</div>
	)
}
