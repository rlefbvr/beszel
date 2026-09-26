import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { LoaderCircleIcon, RefreshCwIcon } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { pb } from "@/lib/api"
import { decimalString } from "@/lib/utils"
import type { SensorRecord } from "@/types"

interface Hop {
	ttl: number
	ip?: string
	name?: string
	rtt: number
}

interface TracerouteResult {
	target: string
	ip: string
	hops: Hop[]
	reached: boolean
	method: "icmp" | "command"
}

/** Route from the hub to the host of a sensor, followed when the dialog opens */
export function TracerouteDialog({ sensor }: { sensor: SensorRecord }) {
	const [result, setResult] = useState<TracerouteResult | null>(null)
	const [error, setError] = useState("")
	const [loading, setLoading] = useState(false)
	const sensorHost = sensor.host
	const hopCount = result?.hops.length ?? 0

	const run = useCallback(async () => {
		setLoading(true)
		setError("")
		setResult(null)
		try {
			setResult(
				await pb.send<TracerouteResult>(`/api/beszel/sensors/${encodeURIComponent(sensor.id)}/traceroute`, {
					requestKey: `traceroute-${sensor.id}`,
				})
			)
		} catch (e) {
			setError((e as Error).message)
		} finally {
			setLoading(false)
		}
	}, [sensor.id])

	useEffect(() => {
		run()
	}, [run])

	return (
		<DialogContent className="max-w-2xl w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto">
			<DialogHeader>
				<DialogTitle>Traceroute</DialogTitle>
				<DialogDescription>
					<Trans>Route from the hub to {sensorHost}.</Trans>
				</DialogDescription>
			</DialogHeader>
			{loading && (
				<p className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
					<LoaderCircleIcon className="size-4 animate-spin" />
					<Trans>Following the route, up to a minute…</Trans>
				</p>
			)}
			{error && <p className="text-sm text-destructive break-words">{error}</p>}
			{result && (
				<div className="grid gap-3">
					<div className="rounded-md border overflow-x-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="px-3 w-12">#</TableHead>
									<TableHead className="px-3">
										<Trans>Address</Trans>
									</TableHead>
									<TableHead className="px-3 w-full">
										<Trans>Name</Trans>
									</TableHead>
									<TableHead className="px-3 text-end whitespace-nowrap">
										<Trans>Response</Trans>
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{result.hops.map((hop) => (
									<TableRow key={hop.ttl}>
										<TableCell className="px-3 py-2 tabular-nums text-muted-foreground">{hop.ttl}</TableCell>
										<TableCell className="px-3 py-2 tabular-nums whitespace-nowrap">
											{hop.ip ?? <span className="text-muted-foreground">*</span>}
										</TableCell>
										<TableCell className="px-3 py-2 text-muted-foreground max-w-0 w-full">
											<span className="block truncate" title={hop.name}>
												{hop.name || (hop.ip ? "-" : t`No answer`)}
											</span>
										</TableCell>
										<TableCell className="px-3 py-2 text-end tabular-nums whitespace-nowrap">
											{hop.ip ? `${decimalString(hop.rtt, hop.rtt < 10 ? 2 : 1)} ms` : "-"}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
					<p className="text-xs text-muted-foreground">
						{result.reached ? (
							<Trans>Host reached in {hopCount} hops.</Trans>
						) : (
							<Trans>Host not reached: the last hops do not answer.</Trans>
						)}{" "}
						{result.method === "command" && <Trans>Traced with the traceroute command of the hub.</Trans>}
					</p>
				</div>
			)}
			{!loading && (
				<div className="flex justify-end">
					<Button variant="outline" className="gap-2" onClick={run}>
						<RefreshCwIcon className="size-4" />
						<Trans>Run again</Trans>
					</Button>
				</div>
			)}
		</DialogContent>
	)
}
