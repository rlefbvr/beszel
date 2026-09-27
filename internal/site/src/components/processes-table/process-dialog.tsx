import { Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { getPagePath } from "@nanostores/router"
import { $router, Link } from "@/components/router"
import { useState } from "react"
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { $allSystemsById } from "@/lib/stores"
import { formatDateTime } from "@/lib/time"
import { TargetAlerts } from "@/components/alerts/target-alerts"
import { formatRate, formatSize, percent, type ProcessRow, usageClass } from "./process-format"
import { ProcessLiveCharts } from "./process-live-charts"

export {
	formatRate,
	formatSize,
	percent,
	type ProcessRow,
	processKey,
	usageClass,
} from "./process-format"

/** Details of a process, with its whole command line */
export function ProcessDialog({ process: initial }: { process: ProcessRow }) {
	const systems = useStore($allSystemsById)
	// the values follow the readings of the charts
	const [process, setProcess] = useState(initial)
	const rows: [React.ReactNode, React.ReactNode][] = [
		[
			<Trans key="s">System</Trans>,
			<Link
				key="sl"
				href={`${getPagePath($router, "system", { id: process.system })}#processes`}
				className="hover:underline underline-offset-2"
			>
				{systems[process.system]?.name ?? process.system}
			</Link>,
		],
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
		<DialogContent className="max-w-3xl w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto">
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
			<ProcessLiveCharts process={initial} onReading={setProcess} />
			<TargetAlerts target={{ kind: "process", name: process.name, system: process.system }} />
		</DialogContent>
	)
}
