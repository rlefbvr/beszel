import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { ArrowRightIcon, BotIcon, CheckCircle2Icon, CircleAlertIcon, DownloadIcon, LoaderCircleIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
	$latestAgentVersion,
	type AgentUpdateResult,
	agentNeedsUpdate,
	agentUpdateErrorLabel,
	updateAgents,
} from "@/lib/agent-updates"
import { isReadOnlyUser } from "@/lib/api"
import { SystemStatus } from "@/lib/enums"
import { $systems } from "@/lib/stores"
import type { SystemRecord } from "@/types"

/** Button next to the view options, opening the update of the outdated agents */
export function AgentUpdateButton() {
	const systems = useStore($systems)
	const latest = useStore($latestAgentVersion)
	const [open, setOpen] = useState(false)

	// only agents that are up can update
	const outdated = useMemo(
		() =>
			systems
				.filter((system) => system.status === SystemStatus.Up && agentNeedsUpdate(system, latest))
				.sort((a, b) => a.name.localeCompare(b.name)),
		[systems, latest]
	)

	if (isReadOnlyUser()) {
		return null
	}

	if (!outdated.length) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					{/* span: disabled buttons don't trigger tooltips */}
					<span className="inline-flex">
						<Button variant="outline" size="icon" disabled aria-label={t`Update agents`}>
							<BotIcon className="size-4" />
						</Button>
					</span>
				</TooltipTrigger>
				<TooltipContent>
					{latest ? (
						<Trans>All agents are up to date ({latest})</Trans>
					) : (
						<Trans>The latest agent version is not known yet</Trans>
					)}
				</TooltipContent>
			</Tooltip>
		)
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button variant="outline" size="icon" className="relative" aria-label={t`Update agents`} onClick={() => setOpen(true)}>
						<DownloadIcon className="size-4" />
						<span className="absolute -top-1.5 -end-1.5 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[0.65rem] leading-4 tabular-nums">
							{outdated.length}
						</span>
					</Button>
				</TooltipTrigger>
				<TooltipContent>
					<Trans>Update agents</Trans>
				</TooltipContent>
			</Tooltip>
			{open && <AgentUpdateDialog outdated={outdated} latest={latest} onClose={() => setOpen(false)} />}
		</Dialog>
	)
}

function AgentUpdateDialog({
	outdated,
	latest,
	onClose,
}: {
	outdated: SystemRecord[]
	latest: string
	onClose: () => void
}) {
	const [scope, setScope] = useState<"all" | "selection">("all")
	const [selected, setSelected] = useState<Set<string>>(() => new Set())
	const [running, setRunning] = useState(false)
	const [results, setResults] = useState<Record<string, AgentUpdateResult>>()
	// systems sent for update: updated agents leave the outdated list when they reconnect
	const [submitted, setSubmitted] = useState<SystemRecord[]>([])

	const targets = scope === "all" ? outdated : outdated.filter((system) => selected.has(system.id))
	const outdatedCount = outdated.length
	const targetCount = targets.length

	const toggle = (id: string, checked: boolean) =>
		setSelected((current) => {
			const next = new Set(current)
			checked ? next.add(id) : next.delete(id)
			return next
		})

	const submit = async () => {
		setRunning(true)
		setSubmitted(targets)
		try {
			setResults(await updateAgents(targets.map((system) => system.id)))
		} catch (e) {
			setResults(Object.fromEntries(targets.map((system) => [system.id, { updated: false, error: (e as Error).message }])))
		} finally {
			setRunning(false)
		}
	}

	return (
		<DialogContent className="max-w-lg">
			<DialogHeader>
				<DialogTitle>
					<Trans>Update agents</Trans>
				</DialogTitle>
				<DialogDescription>
					<Trans>The agents download version {latest} from GitHub, then restart.</Trans>
				</DialogDescription>
			</DialogHeader>

			{results ? (
				<ul className="grid gap-2 text-sm max-h-80 overflow-y-auto">
					{submitted.map((system) => {
						const result = results[system.id]
						return (
							<li key={system.id} className="flex gap-2 items-start">
								{result?.error ? (
									<CircleAlertIcon className="size-4 mt-0.5 shrink-0 text-red-500" />
								) : (
									<CheckCircle2Icon className="size-4 mt-0.5 shrink-0 text-green-500" />
								)}
								<div className="grid">
									<span className="font-medium">{system.name}</span>
									<span className="text-muted-foreground">
										{result?.error ? (
											agentUpdateErrorLabel(result.error)
										) : result?.updated ? (
											<Trans>Updated, the agent restarts.</Trans>
										) : (
											<Trans>Already up to date.</Trans>
										)}
									</span>
								</div>
							</li>
						)
					})}
				</ul>
			) : (
				<>
					<Tabs value={scope} onValueChange={(value) => setScope(value as "all" | "selection")}>
						<TabsList className="grid w-full grid-cols-2">
							<TabsTrigger value="all">
								<Trans>All outdated ({outdatedCount})</Trans>
							</TabsTrigger>
							<TabsTrigger value="selection">
								<Trans>Selection</Trans>
							</TabsTrigger>
						</TabsList>
					</Tabs>

					{scope === "selection" && (
						<div className="grid gap-2 max-h-48 overflow-y-auto rounded-md border p-3">
							{outdated.map((system) => (
								<div key={system.id} className="flex items-center gap-2 text-sm">
									<Checkbox
										id={`agent-update-${system.id}`}
										checked={selected.has(system.id)}
										onCheckedChange={(checked) => toggle(system.id, checked === true)}
									/>
									<label htmlFor={`agent-update-${system.id}`} className="cursor-pointer">
										{system.name}
									</label>
								</div>
							))}
						</div>
					)}

					<div className="grid gap-1.5">
						<p className="text-sm font-medium">
							<Trans>Systems to update ({targetCount})</Trans>
						</p>
						<ul className="grid gap-1 text-sm max-h-48 overflow-y-auto">
							{targets.map((system) => (
								<li key={system.id} className="flex items-center gap-2">
									<span className="truncate">{system.name}</span>
									<span className="ms-auto flex items-center gap-1 text-muted-foreground tabular-nums">
										{system.info.v}
										<ArrowRightIcon className="size-3" />
										{latest}
									</span>
								</li>
							))}
							{!targets.length && (
								<li className="text-muted-foreground">
									<Trans>Select the systems to update.</Trans>
								</li>
							)}
						</ul>
					</div>
				</>
			)}

			<DialogFooter>
				{results ? (
					<Button onClick={onClose}>
						<Trans>Close</Trans>
					</Button>
				) : (
					<>
						<Button variant="outline" onClick={onClose} disabled={running}>
							<Trans>Cancel</Trans>
						</Button>
						<Button className="gap-2" onClick={submit} disabled={running || !targets.length}>
							{running ? <LoaderCircleIcon className="size-4 animate-spin" /> : <DownloadIcon className="size-4" />}
							<Trans>Update</Trans>
						</Button>
					</>
				)}
			</DialogFooter>
		</DialogContent>
	)
}
