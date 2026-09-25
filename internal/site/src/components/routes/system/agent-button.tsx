import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { BotIcon, DownloadIcon } from "lucide-react"
import { lazy, Suspense, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { $latestAgentVersion, agentNeedsUpdate } from "@/lib/agent-updates"
import type { SystemRecord } from "@/types"

const AgentDetails = lazy(() => import("./agent-details"))

/** Button of the system page toolbar opening the details of the agent, marked when an update is available */
export function AgentButton({ system }: { system: SystemRecord }) {
	const latest = useStore($latestAgentVersion)
	const [open, setOpen] = useState(false)
	const outdated = agentNeedsUpdate(system, latest)
	const version = system.info?.v
	const Icon = outdated ? DownloadIcon : BotIcon

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button variant="outline" size="icon" className="relative" aria-label={t`Agent`} onClick={() => setOpen(true)}>
						<Icon className="size-4" />
						{outdated && <span className="absolute top-1.5 end-1.5 size-2 rounded-full bg-orange-500" />}
					</Button>
				</TooltipTrigger>
				<TooltipContent>
					<p>{version ? <Trans>Agent {version}</Trans> : <Trans>Agent</Trans>}</p>
					{outdated && (
						<p className="text-orange-500">
							<Trans>Update available: {latest}</Trans>
						</p>
					)}
				</TooltipContent>
			</Tooltip>
			{open && (
				<DialogContent className="max-w-3xl w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto">
					<Suspense>
						<AgentDetails system={system} />
					</Suspense>
				</DialogContent>
			)}
		</Dialog>
	)
}
