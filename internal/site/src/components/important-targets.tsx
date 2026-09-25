import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { BellRingIcon, XIcon } from "lucide-react"
import { type ReactNode, useState } from "react"
import { failedToast } from "@/components/alerts/state-alert-rules"
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
import { isReadOnlyUser, pb } from "@/lib/api"
import { $stateAlerts, planTargetRemoval } from "@/lib/state-alerts"
import { cn } from "@/lib/utils"
import type { StateAlertRecord } from "@/types"

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
	/** the target, to remove it from the state rules */
	target?: { kind: StateAlertRecord["kind"]; system: string }
}

/** Services or containers targeted by a state alert rule, shown above their table */
export function ImportantTargets({ title, tiles }: { title: ReactNode; tiles: ImportantTile[] }) {
	const [removing, setRemoving] = useState<ImportantTile | null>(null)
	const canRemove = !isReadOnlyUser()
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
					<div key={tile.key} className="relative group min-w-0">
						<button
							type="button"
							onClick={tile.onClick}
							disabled={!tile.onClick}
							className={cn(
								"w-full text-start rounded-md border px-3 py-2.5 grid gap-1 min-w-0 transition-colors",
								tile.onClick ? "hover:bg-muted/50 cursor-pointer" : "cursor-default",
								tile.triggered ? "border-red-500/50 bg-red-500/5" : "bg-muted/20",
								canRemove && tile.target && "pe-9"
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
						{canRemove && tile.target && (
							<button
								type="button"
								aria-label={t`Remove from important`}
								title={t`Remove from important`}
								onClick={() => setRemoving(tile)}
								className="absolute top-1.5 end-1.5 rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-muted hover:text-foreground transition-opacity"
							>
								<XIcon className="size-3.5" />
							</button>
						)}
					</div>
				))}
			</div>
			{removing && <RemoveImportantDialog tile={removing} onClose={() => setRemoving(null)} />}
		</div>
	)
}

/** Confirms and removes a service or container from the state rules targeting it */
function RemoveImportantDialog({ tile, onClose }: { tile: ImportantTile; onClose: () => void }) {
	const [removal] = useState(() =>
		tile.target ? planTargetRemoval($stateAlerts.get(), tile.target.kind, tile.target.system, tile.name) : undefined
	)
	const [saving, setSaving] = useState(false)
	const name = tile.name

	async function remove() {
		if (!removal) {
			return
		}
		setSaving(true)
		try {
			const collection = pb.collection<StateAlertRecord>("state_alerts")
			const deleted = [...removal.deletes, ...removal.wildcards]
			const updated = await Promise.all(removal.updates.map(({ rule, targets }) => collection.update(rule.id, { targets })))
			await Promise.all(deleted.map((rule) => collection.delete(rule.id)))
			for (const rule of updated) {
				$stateAlerts.setKey(rule.id, rule)
			}
			const remaining = { ...$stateAlerts.get() }
			for (const rule of deleted) {
				delete remaining[rule.id]
			}
			$stateAlerts.set(remaining)
			onClose()
		} catch (e) {
			failedToast(e)
		} finally {
			setSaving(false)
		}
	}

	return (
		<AlertDialog open onOpenChange={(open) => !open && onClose()}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						<Trans>Remove {name} from important?</Trans>
					</AlertDialogTitle>
					<AlertDialogDescription asChild>
						<div className="grid gap-2 text-sm">
							<p>
								<Trans>Its state alerts stop. The following rules change:</Trans>
							</p>
							<ul className="grid gap-1 list-disc ps-5">
								{removal?.updates.map(({ rule, targets }) => (
									<li key={rule.id}>
										<Trans>Removed from the rule, which keeps: {targets}</Trans>
									</li>
								))}
								{removal?.deletes.map(({ id, targets }) => (
									<li key={id}>
										<Trans>Rule deleted: {targets}</Trans>
									</li>
								))}
								{removal?.wildcards.map(({ id, targets }) => (
									<li key={id} className="text-red-600 dark:text-red-400">
										<Trans>Rule deleted, its pattern also covers other items: {targets}</Trans>
									</li>
								))}
							</ul>
						</div>
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={saving}>
						<Trans>Cancel</Trans>
					</AlertDialogCancel>
					<AlertDialogAction
						disabled={saving}
						onClick={(e) => {
							e.preventDefault()
							remove()
						}}
					>
						<Trans>Remove</Trans>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
