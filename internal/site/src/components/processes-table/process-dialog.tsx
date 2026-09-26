import { Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { $allSystemsById } from "@/lib/stores"
import { formatDateTime } from "@/lib/time"
import { decimalString, formatBytes } from "@/lib/utils"

/** A process of a host, as the agent reads it */
export interface ProcessRow {
	pid: number
	ppid?: number
	name: string
	user?: string
	status?: string
	command?: string
	cpu?: number
	mem?: number
	rss?: number
	dr?: number
	dw?: number
	threads?: number
	conns?: number
	started?: number
	/** system of the process, added by the page */
	system: string
}

/** Identifies a process across the readings: the PID with its start time, as PIDs are reused */
export const processKey = (process: Pick<ProcessRow, "pid" | "started">) => `p${process.pid}_${process.started ?? 0}`

export function formatRate(bytes?: number) {
	if (!bytes) {
		return "-"
	}
	const { value, unit } = formatBytes(bytes, true)
	return `${decimalString(value, value >= 10 ? 0 : 1)} ${unit}`
}

export function formatSize(bytes?: number) {
	if (!bytes) {
		return "-"
	}
	const { value, unit } = formatBytes(bytes)
	return `${decimalString(value, value >= 10 ? 0 : 1)} ${unit}`
}

export function percent(value?: number) {
	return value ? `${decimalString(value, value >= 10 ? 1 : 2)}%` : "-"
}

/** Share of the whole host from which a process is shown as heavy, then as very heavy */
const heavyUse = 25
const veryHeavyUse = 50

/** Colors a CPU or memory share of the host when a process uses much of it */
export function usageClass(value?: number) {
	if (!value || value < heavyUse) {
		return ""
	}
	return value >= veryHeavyUse
		? "text-red-600 dark:text-red-400 font-semibold"
		: "text-amber-600 dark:text-amber-400 font-medium"
}

/** Details of a process, with its whole command line */
export function ProcessDialog({ process }: { process: ProcessRow }) {
	const systems = useStore($allSystemsById)
	const rows: [React.ReactNode, React.ReactNode][] = [
		[<Trans key="s">System</Trans>, systems[process.system]?.name ?? process.system],
		["PID", process.pid],
		[<Trans key="p">Parent process</Trans>, process.ppid || "-"],
		[<Trans key="u">User</Trans>, process.user || "-"],
		[<Trans key="c">CPU</Trans>, <span className={usageClass(process.cpu)}>{percent(process.cpu)}</span>],
		[
			<Trans key="m">Memory</Trans>,
			<span key="mv">
				<span className={usageClass(process.mem)}>{percent(process.mem)}</span> · {formatSize(process.rss)}
			</span>,
		],
		[<Trans key="d">Disk</Trans>, `↓ ${formatRate(process.dr)} · ↑ ${formatRate(process.dw)}`],
		[<Trans key="n">Network connections</Trans>, process.conns || "-"],
		[<Trans key="t">Threads</Trans>, process.threads || "-"],
		[<Trans key="st">Started</Trans>, process.started ? formatDateTime(process.started * 1000) : "-"],
		[<Trans key="stt">Status</Trans>, process.status || "-"],
	]
	return (
		<DialogContent className="max-w-2xl w-[calc(100vw-2rem)]">
			<DialogHeader>
				<DialogTitle className="break-all">{process.name}</DialogTitle>
				<DialogDescription>
					<Trans>Values of the last reading by the agent.</Trans>
				</DialogDescription>
			</DialogHeader>
			<dl className="grid sm:grid-cols-[10rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
				{rows.map(([label, value], index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: fixed list
					<div key={index} className="contents">
						<dt className="text-muted-foreground">{label}</dt>
						<dd className="tabular-nums break-words">{value}</dd>
					</div>
				))}
			</dl>
			{process.command && (
				<pre className="rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-all max-h-60 overflow-auto">
					{process.command}
				</pre>
			)}
		</DialogContent>
	)
}
