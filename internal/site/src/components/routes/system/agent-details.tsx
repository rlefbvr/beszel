import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { CheckIcon, DownloadIcon, LoaderCircleIcon, LogsIcon, RefreshCwIcon, XIcon } from "lucide-react"
import type { ClientResponseError } from "pocketbase"
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { $latestAgentVersion, agentNeedsUpdate, agentUpdateErrorLabel, updateAgents } from "@/lib/agent-updates"
import { isReadOnlyUser, pb } from "@/lib/api"
import { SystemStatus } from "@/lib/enums"
import { cn, formatShortDate } from "@/lib/utils"
import type { SystemRecord } from "@/types"

/** How the agent runs on its host, as reported by the agent */
interface AgentInfo {
	Version: string
	Executable?: string
	DataDir?: string
	User?: string
	ServiceManager?: string
	ServiceName?: string
	StartedAt?: string
	Dependencies?: { Name: string; Found?: boolean; Detail?: string }[]
	SelfUpdate?: boolean
	SelfUpdateBlocker?: string
}

const serviceManagerLabels: Record<string, () => string> = {
	systemd: () => "systemd",
	openrc: () => "OpenRC",
	procd: () => "procd",
	rc: () => "rc.d",
	launchd: () => "launchd",
	nssm: () => t`Windows service (NSSM)`,
	docker: () => t`Container`,
	manual: () => t`Started manually`,
}

/** The hub answers with a conflict the requests an agent is too old for */
function isAgentOutdated(e: unknown) {
	return (e as ClientResponseError).status === 409
}

/** Status, location, dependencies, logs and update of the agent of a system, shown in a dialog */
export default function AgentDetails({ system }: { system: SystemRecord }) {
	const latest = useStore($latestAgentVersion)
	const [info, setInfo] = useState<AgentInfo>()
	const [error, setError] = useState<string>()
	const [loading, setLoading] = useState(true)
	const [updating, setUpdating] = useState(false)
	const [logsOpen, setLogsOpen] = useState(false)
	const { toast } = useToast()
	const isUp = system.status === SystemStatus.Up

	const load = useCallback(async () => {
		setLoading(true)
		try {
			setInfo(await pb.send<AgentInfo>("/api/beszel/agent/info", { query: { system: system.id } }))
			setError(undefined)
		} catch (e) {
			setError(
				isAgentOutdated(e)
					? agentUpdateErrorLabel("outdated")
					: t`Agent details are not available: the agent may need an update.`
			)
		} finally {
			setLoading(false)
		}
	}, [system.id])

	useEffect(() => {
		if (isUp) {
			load()
		} else {
			setLoading(false)
		}
	}, [isUp, load])

	const outdated = agentNeedsUpdate(system, latest)

	const update = async () => {
		setUpdating(true)
		try {
			const result = (await updateAgents([system.id]))[system.id]
			if (result?.error) {
				toast({ variant: "destructive", title: t`Update failed`, description: agentUpdateErrorLabel(result.error) })
			} else {
				toast({
					title: result?.updated ? t`Agent updated` : t`Already up to date.`,
					description: result?.updated ? t`The agent restarts and reconnects on its own.` : undefined,
				})
			}
		} catch (e) {
			toast({ variant: "destructive", title: t`Update failed`, description: (e as Error).message })
		} finally {
			setUpdating(false)
		}
	}

	return (
		<>
			<DialogHeader>
				<DialogTitle>
					<Trans>Agent</Trans>
				</DialogTitle>
				<DialogDescription>
					<Trans>How the agent runs on this system.</Trans>
				</DialogDescription>
			</DialogHeader>

			<div className="flex flex-wrap items-center gap-2">
				<Button variant="outline" size="sm" className="gap-2" onClick={() => setLogsOpen(true)} disabled={!isUp}>
					<LogsIcon className="size-4" />
					<Trans>Logs</Trans>
				</Button>
				{outdated && isUp && !isReadOnlyUser() && (
					<Button
						size="sm"
						className="gap-2"
						onClick={update}
						disabled={updating || !info?.SelfUpdate}
						title={info?.SelfUpdateBlocker ? agentUpdateErrorLabel(info.SelfUpdateBlocker) : undefined}
					>
						{updating ? <LoaderCircleIcon className="size-4 animate-spin" /> : <DownloadIcon className="size-4" />}
						<Trans>Update</Trans>
					</Button>
				)}
				<Button
					variant="ghost"
					size="icon"
					className="size-9 ms-auto"
					onClick={load}
					disabled={!isUp || loading}
					aria-label={t`Refresh`}
				>
					<RefreshCwIcon className={cn("size-4", loading && "animate-spin")} />
				</Button>
			</div>

			{!isUp ? (
				<p className="text-sm text-muted-foreground">
					<Trans>The system is not connected.</Trans>
				</p>
			) : error ? (
				<p className="text-sm text-muted-foreground">{error}</p>
			) : !info ? (
				<LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />
			) : (
				<dl className="grid sm:grid-cols-[max-content_1fr] gap-x-6 gap-y-2.5 text-sm">
					<Row label={<Trans>Version</Trans>}>
						<div className="flex flex-wrap items-center gap-2">
							<span className="tabular-nums">{info.Version}</span>
							{latest &&
								(outdated ? (
									<Badge variant="warning">
										<Trans>Update available: {latest}</Trans>
									</Badge>
								) : (
									<Badge variant="success">
										<Trans>Up to date</Trans>
									</Badge>
								))}
							{outdated && !info.SelfUpdate && info.SelfUpdateBlocker && (
								<span className="text-muted-foreground">{agentUpdateErrorLabel(info.SelfUpdateBlocker)}</span>
							)}
						</div>
					</Row>
					<Row label={<Trans>Service</Trans>}>
						{serviceManagerLabels[info.ServiceManager ?? ""]?.() ?? info.ServiceManager}
						{info.ServiceName && <span className="text-muted-foreground"> · {info.ServiceName}</span>}
					</Row>
					<Row label={<Trans>Location</Trans>}>
						<code className="break-all">{info.Executable}</code>
					</Row>
					{info.DataDir && (
						<Row label={<Trans>Data directory</Trans>}>
							<code className="break-all">{info.DataDir}</code>
						</Row>
					)}
					{info.User && <Row label={<Trans>Account</Trans>}>{info.User}</Row>}
					{info.StartedAt && <Row label={<Trans>Started</Trans>}>{formatShortDate(info.StartedAt)}</Row>}
					<Row label={<Trans>Dependencies</Trans>}>
						<ul className="flex flex-wrap gap-2">
							{info.Dependencies?.map((dep) => (
								<li
									key={dep.Name}
									title={dep.Detail}
									className={cn(
										"flex items-center gap-1 rounded-md border px-2 py-0.5",
										!dep.Found && "text-muted-foreground border-dashed"
									)}
								>
									{dep.Found ? <CheckIcon className="size-3.5 text-green-600" /> : <XIcon className="size-3.5" />}
									{dep.Name}
									{dep.Found && dep.Detail && !dep.Detail.includes("/") && !dep.Detail.includes("\\") && (
										<span className="text-muted-foreground">({dep.Detail})</span>
									)}
								</li>
							))}
						</ul>
					</Row>
				</dl>
			)}

			<Dialog open={logsOpen} onOpenChange={setLogsOpen}>
				{logsOpen && <AgentLogs system={system} />}
			</Dialog>
		</>
	)
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
	return (
		<>
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="min-w-0">{children}</dd>
		</>
	)
}

/** Last lines logged by the agent, kept in its memory */
function AgentLogs({ system }: { system: SystemRecord }) {
	const [logs, setLogs] = useState<string>()
	const [loading, setLoading] = useState(false)
	const logsRef = useRef<HTMLPreElement>(null)

	const load = useCallback(async () => {
		setLoading(true)
		try {
			const { logs } = await pb.send<{ logs: string }>("/api/beszel/agent/logs", { query: { system: system.id } })
			setLogs(logs || t`No logs yet.`)
		} catch (e) {
			setLogs(isAgentOutdated(e) ? agentUpdateErrorLabel("outdated") : (e as Error).message)
		} finally {
			setLoading(false)
		}
	}, [system.id])

	useEffect(() => {
		load()
	}, [load])

	// show the most recent lines
	useEffect(() => {
		logsRef.current?.scrollTo({ top: logsRef.current.scrollHeight })
	}, [logs])

	return (
		<DialogContent className="max-w-5xl w-[calc(100vw-2rem)]">
			<DialogHeader>
				<DialogTitle className="flex items-center gap-2">
					<Trans>Agent logs</Trans>
					<Button variant="ghost" size="icon" className="size-7" onClick={load} disabled={loading} aria-label={t`Refresh`}>
						<RefreshCwIcon className={cn("size-4", loading && "animate-spin")} />
					</Button>
				</DialogTitle>
				<DialogDescription>
					<Trans>Last lines logged by the agent of {{ name: system.name }} since it started.</Trans>
				</DialogDescription>
			</DialogHeader>
			<pre
				ref={logsRef}
				className="h-[60vh] overflow-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed whitespace-pre-wrap break-all"
			>
				{logs ?? <LoaderCircleIcon className="size-4 animate-spin" />}
			</pre>
		</DialogContent>
	)
}
