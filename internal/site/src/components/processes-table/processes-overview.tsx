import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { getPagePath } from "@nanostores/router"
import { CpuIcon, LoaderCircleIcon, MemoryStickIcon, RefreshCwIcon, SearchIcon, XIcon } from "lucide-react"
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { $router, Link } from "@/components/router"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { pb } from "@/lib/api"
import { $allSystemsById, $systems } from "@/lib/stores"
import { cn } from "@/lib/utils"
import { formatRate, formatSize, percent, ProcessDialog, type ProcessRow, usageClass } from "./process-dialog"

/** Processes of a host, summed up by the hub */
interface ProcessesOverview {
	system: string
	error?: string
	count: number
	cpu: number
	mem: number
	topCpu: ProcessRow[]
	topMem: ProcessRow[]
	matches: ProcessRow[]
}

type RawOverview = Omit<ProcessesOverview, "topCpu" | "topMem" | "matches"> & {
	topCpu?: Omit<ProcessRow, "system">[]
	topMem?: Omit<ProcessRow, "system">[]
	matches?: Omit<ProcessRow, "system">[]
}

/** Processes kept for each host in the top consumers */
const topCount = 3

/** Asks the hub for the processes of the hosts: it reads the agents and keeps the top ones or the matches */
async function fetchOverview(systems: string[], params: { top?: number; q?: string }) {
	const res = await pb.send<{ systems: RawOverview[] }>("/api/beszel/processes/overview", {
		query: { systems: systems.join(","), ...params },
		requestKey: null,
	})
	return res.systems.map(
		(overview): ProcessesOverview => ({
			...overview,
			topCpu: (overview.topCpu ?? []).map((process) => ({ ...process, system: overview.system })),
			topMem: (overview.topMem ?? []).map((process) => ({ ...process, system: overview.system })),
			matches: (overview.matches ?? []).map((process) => ({ ...process, system: overview.system })),
		})
	)
}

/** IDs of the systems that are up, the ones whose agent can answer */
function useUpSystems() {
	const systems = useStore($systems)
	const key = systems
		.filter((system) => system.status === "up")
		.map((system) => system.id)
		.sort()
		.join()
	return useMemo(() => (key ? key.split(",") : []), [key])
}

function SystemLink({ id }: { id: string }) {
	const systems = useStore($allSystemsById)
	return (
		<Link
			href={getPagePath($router, "system", { id })}
			className="font-medium hover:underline underline-offset-2"
			onClick={(e) => e.stopPropagation()}
		>
			{systems[id]?.name ?? id}
		</Link>
	)
}

/** Hosts that could not answer: agents too old, or errors */
function Unanswered({ overviews }: { overviews: ProcessesOverview[] }) {
	const outdated = overviews.filter((overview) => overview.error === "outdated").length
	const failed = overviews.filter((overview) => overview.error && overview.error !== "outdated").length
	if (!outdated && !failed) {
		return null
	}
	return (
		<p className="text-sm text-muted-foreground mt-3">
			{outdated > 0 && <Trans>{outdated} system(s) need an agent update (0.20.0-fork.5 or newer).</Trans>}{" "}
			{failed > 0 && <Trans>{failed} system(s) did not answer.</Trans>}
		</p>
	)
}

/**
 * Page of all the processes: nothing is read until a search, apart from the
 * few top consumers of each host, so that it stays light with many systems.
 */
export default function ProcessesOverviewPage() {
	const [selected, setSelected] = useState<ProcessRow | null>(null)
	return (
		<>
			<ProcessSearch onSelect={setSelected} />
			<TopConsumers onSelect={setSelected} />
			<Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
				{selected && <ProcessDialog process={selected} />}
			</Dialog>
		</>
	)
}

/** Looks for a process on all the hosts that are up */
function ProcessSearch({ onSelect }: { onSelect: (process: ProcessRow) => void }) {
	const systems = useUpSystems()
	const [query, setQuery] = useState("")
	const [searched, setSearched] = useState("")
	const [loading, setLoading] = useState(false)
	const [results, setResults] = useState<ProcessesOverview[]>()

	const search = async (e?: FormEvent) => {
		e?.preventDefault()
		const q = query.trim()
		if (!q) {
			return
		}
		setLoading(true)
		try {
			setResults(await fetchOverview(systems, { q }))
			setSearched(q)
		} finally {
			setLoading(false)
		}
	}

	const matches = useMemo(
		() => (results ?? []).flatMap((overview) => overview.matches).sort((a, b) => (b.cpu ?? 0) - (a.cpu ?? 0)),
		[results]
	)
	const matchCount = matches.length
	const systemCount = new Set(matches.map((process) => process.system)).size

	return (
		<Card className="w-full px-3 py-5 sm:py-6 sm:px-6">
			<CardHeader className="p-0 mb-4 px-2 sm:px-1">
				<CardTitle className="mb-1.5">
					<Trans>Search a process</Trans>
				</CardTitle>
				<CardDescription>
					<Trans>Looks for a process on all the systems that are up, by name, command, user or PID.</Trans>
				</CardDescription>
			</CardHeader>
			<form onSubmit={search} className="flex gap-2 max-w-xl">
				<div className="relative flex-1">
					<Input
						placeholder={t`nginx, sqlservr, java…`}
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						className="ps-4 pe-10 w-full"
					/>
					{query && (
						<Button
							type="button"
							variant="ghost"
							size="icon"
							aria-label={t`Clear`}
							className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground"
							onClick={() => {
								setQuery("")
								setResults(undefined)
							}}
						>
							<XIcon className="h-4 w-4" />
						</Button>
					)}
				</div>
				<Button type="submit" disabled={loading || !query.trim() || !systems.length}>
					{loading ? (
						<LoaderCircleIcon className="me-1.5 size-4 animate-spin" />
					) : (
						<SearchIcon className="me-1.5 size-4" />
					)}
					<Trans>Search</Trans>
				</Button>
			</form>
			{results && (
				<div className="mt-4">
					<p className="text-sm text-muted-foreground mb-2 px-1">
						<Trans>
							{matchCount} process(es) on {systemCount} system(s) for “{searched}”
						</Trans>
					</p>
					{matches.length > 0 && (
						<div className="border rounded-md overflow-auto max-h-[60dvh]">
							<table className="text-sm w-full text-nowrap">
								<TableHeader className="sticky top-0 z-10 bg-card">
									<TableRow>
										<TableHead className="px-4">
											<Trans>System</Trans>
										</TableHead>
										<TableHead className="px-4">
											<Trans>Name</Trans>
										</TableHead>
										<TableHead className="px-4">PID</TableHead>
										<TableHead className="px-4">
											<Trans>User</Trans>
										</TableHead>
										<TableHead className="px-4">
											<Trans>CPU</Trans>
										</TableHead>
										<TableHead className="px-4">
											<Trans>Memory</Trans>
										</TableHead>
										<TableHead className="px-4">
											<Trans>Disk</Trans>
										</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{matches.map((process) => (
										<TableRow
											key={`${process.system}/${process.pid}`}
											className="cursor-pointer"
											onClick={() => onSelect(process)}
										>
											<TableCell className="px-4 py-2">
												<SystemLink id={process.system} />
											</TableCell>
											<TableCell className="px-4 py-2 max-w-64 truncate" title={process.command || process.name}>
												{process.name}
											</TableCell>
											<TableCell className="px-4 py-2 tabular-nums">{process.pid}</TableCell>
											<TableCell className="px-4 py-2 max-w-40 truncate text-muted-foreground">
												{process.user || "-"}
											</TableCell>
											<TableCell className={cn("px-4 py-2 tabular-nums", usageClass(process.cpu))}>
												{percent(process.cpu)}
											</TableCell>
											<TableCell className="px-4 py-2 tabular-nums">
												<span className={usageClass(process.mem)}>{percent(process.mem)}</span>
												<span className="ms-1.5 text-xs text-muted-foreground">{formatSize(process.rss)}</span>
											</TableCell>
											<TableCell className="px-4 py-2 tabular-nums text-muted-foreground">
												↓ {formatRate(process.dr)} · ↑ {formatRate(process.dw)}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</table>
						</div>
					)}
					<Unanswered overviews={results} />
				</div>
			)}
		</Card>
	)
}

/** The few processes that use the most CPU and memory on each host, read once and on demand */
function TopConsumers({ onSelect }: { onSelect: (process: ProcessRow) => void }) {
	const systems = useUpSystems()
	const [loading, setLoading] = useState(false)
	const [overviews, setOverviews] = useState<ProcessesOverview[]>()

	const load = useCallback(async () => {
		setLoading(true)
		try {
			setOverviews(await fetchOverview(systems, { top: topCount }))
		} finally {
			setLoading(false)
		}
	}, [systems])

	// read once, when the systems are known; then on demand
	const loaded = useRef(false)
	useEffect(() => {
		if (!loaded.current && systems.length) {
			loaded.current = true
			load()
		}
	}, [systems, load])

	const answered = useMemo(
		() => (overviews ?? []).filter((overview) => !overview.error).sort((a, b) => b.cpu - a.cpu),
		[overviews]
	)

	return (
		<Card className="w-full px-3 py-5 sm:py-6 sm:px-6">
			<CardHeader className="p-0 mb-4 px-2 sm:px-1 flex-row items-start gap-3">
				<div className="me-auto">
					<CardTitle className="mb-1.5">
						<Trans>Top consumers</Trans>
					</CardTitle>
					<CardDescription>
						<Trans>The processes that use the most CPU and memory on each system that is up, at the time of the reading.</Trans>
					</CardDescription>
				</div>
				<Button variant="outline" size="icon" onClick={load} disabled={loading} aria-label={t`Refresh`}>
					{loading ? <LoaderCircleIcon className="size-4 animate-spin" /> : <RefreshCwIcon className="size-4" />}
				</Button>
			</CardHeader>
			{overviews === undefined ? (
				<div className="h-24 grid place-items-center text-muted-foreground">
					{loading || systems.length ? (
						<LoaderCircleIcon className="size-5 animate-spin" />
					) : (
						<Trans>No systems are up.</Trans>
					)}
				</div>
			) : (
				<>
					<div className={cn("grid gap-3 sm:grid-cols-2 2xl:grid-cols-3", loading && "opacity-60")}>
						{answered.map((overview) => (
							<HostTop key={overview.system} overview={overview} onSelect={onSelect} />
						))}
					</div>
					<Unanswered overviews={overviews} />
				</>
			)}
		</Card>
	)
}

function HostTop({
	overview,
	onSelect,
}: {
	overview: ProcessesOverview
	onSelect: (process: ProcessRow) => void
}) {
	const count = overview.count
	const cpuText = percent(overview.cpu)
	const memText = percent(overview.mem)
	return (
		<div className="rounded-md border p-3">
			<div className="flex flex-wrap items-baseline gap-x-2 mb-2">
				<SystemLink id={overview.system} />
				<span className="ms-auto text-xs text-muted-foreground tabular-nums">
					<Trans>
						{count} processes · CPU {cpuText} · Memory {memText}
					</Trans>
				</span>
			</div>
			<div className="grid grid-cols-2 gap-3">
				<TopList
					icon={CpuIcon}
					title={t`CPU`}
					processes={overview.topCpu}
					value={(process) => process.cpu}
					onSelect={onSelect}
				/>
				<TopList
					icon={MemoryStickIcon}
					title={t`Memory`}
					processes={overview.topMem}
					value={(process) => process.mem}
					onSelect={onSelect}
				/>
			</div>
		</div>
	)
}

function TopList({
	icon: Icon,
	title,
	processes,
	value,
	onSelect,
}: {
	icon: React.ElementType
	title: string
	processes: ProcessRow[]
	value: (process: ProcessRow) => number | undefined
	onSelect: (process: ProcessRow) => void
}) {
	return (
		<div className="min-w-0">
			<div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
				<Icon className="size-3.5" />
				{title}
			</div>
			{processes.length ? (
				<ul className="grid gap-0.5">
					{processes.map((process) => (
						<li key={process.pid}>
							<button
								type="button"
								onClick={() => onSelect(process)}
								className="w-full flex items-baseline gap-2 text-sm rounded px-1 -mx-1 hover:bg-accent/60 text-start"
								title={process.command || process.name}
							>
								<span className="truncate">{process.name}</span>
								<span className={cn("ms-auto tabular-nums text-xs", usageClass(value(process)))}>
									{percent(value(process))}
								</span>
							</button>
						</li>
					))}
				</ul>
			) : (
				<p className="text-sm text-muted-foreground">-</p>
			)}
		</div>
	)
}
