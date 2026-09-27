import { t } from "@lingui/core/macro"
import { Plural, Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { getPagePath } from "@nanostores/router"
import {
	ContainerIcon,
	CpuIcon,
	ExternalLinkIcon,
	GlobeIcon,
	LoaderCircleIcon,
	LockIcon,
	RefreshCwIcon,
	ScrollTextIcon,
	ServerIcon,
	WaypointsIcon,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { ReadAccessHint } from "@/components/read-access-hint"
import { $router, Link, navigate } from "@/components/router"
import { SortableHead, type TableSort } from "@/components/sortable-head"
import { cellWidthStyle, resizedAttr, useTableLayout } from "@/components/table-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table"
import { announceSection } from "@/lib/linked-section"
import { $openRequest } from "@/lib/recent"
import { $allSystemsById, $systems } from "@/lib/stores"
import {
	fetchTraefik,
	fetchTraefikLog,
	type TraefikInstance,
	type TraefikOverview,
	type TraefikRoute,
	traefikDashboard,
	traefikRouteUrl,
} from "@/lib/traefik"
import { cn } from "@/lib/utils"

/** A log of an instance opened in a dialog */
interface OpenLog {
	system: string
	instance: string
	access: boolean
}

/**
 * The Traefik instances of the hosts that are up, or of one host: their
 * dashboard, logs and access logs, ACME resolvers and the routes of their
 * containers. Read from the agents when shown; hidden for one host without Traefik.
 */
export function TraefikInstances({ systemId }: { systemId?: string }) {
	const allSystems = useStore($systems)
	const systemsById = useStore($allSystemsById)
	const upKey = allSystems
		.filter((system) => system.status === "up" && (!systemId || system.id === systemId))
		.map((system) => system.id)
		.sort()
		.join()
	const [overviews, setOverviews] = useState<TraefikOverview[]>()
	const [loading, setLoading] = useState(false)
	const [openLog, setOpenLog] = useState<OpenLog | null>(null)

	const load = useCallback(async () => {
		setLoading(true)
		try {
			setOverviews(await fetchTraefik(upKey ? upKey.split(",") : []))
		} catch {
			setOverviews([])
		} finally {
			setLoading(false)
		}
	}, [upKey])

	// read once the systems are known
	const [loaded, setLoaded] = useState(false)
	useEffect(() => {
		if (!loaded && upKey) {
			setLoaded(true)
			load()
		}
	}, [upKey, loaded, load])

	const instances = useMemo(
		() =>
			(overviews ?? [])
				.flatMap((overview) => overview.instances.map((instance) => ({ system: overview.system, instance })))
				.sort(
					(a, b) =>
						(systemsById[a.system]?.name ?? "").localeCompare(systemsById[b.system]?.name ?? "") ||
						a.instance.name.localeCompare(b.instance.name)
				),
		[overviews, systemsById]
	)
	const outdated = (overviews ?? []).filter((overview) => overview.error === "outdated").length

	// on the page of a host, nothing without Traefik
	if (systemId && !instances.length) {
		return null
	}

	return (
		<Card className="@container w-full px-3 py-5 sm:py-6 sm:px-6">
			<CardHeader className="p-0 mb-3 sm:mb-4 px-2 sm:px-1">
				<div className="flex items-start gap-3">
					<div className="grid gap-1.5 flex-1">
						<CardTitle>
							<Trans>Traefik reverse proxy</Trans>
						</CardTitle>
						<CardDescription>
							<Trans>
								The Traefik instances of the systems that are up, with their dashboard, logs, Let's Encrypt resolvers
								and the addresses of their containers.
							</Trans>
						</CardDescription>
					</div>
					<Button
						variant="outline"
						size="icon"
						className="shrink-0"
						onClick={load}
						disabled={loading}
						aria-label={t`Refresh`}
						title={t`Refresh`}
					>
						{loading ? <LoaderCircleIcon className="size-4 animate-spin" /> : <RefreshCwIcon className="size-4" />}
					</Button>
				</div>
			</CardHeader>
			{overviews === undefined ? (
				<div className="h-20 grid place-items-center text-muted-foreground">
					<LoaderCircleIcon className="size-5 animate-spin" />
				</div>
			) : (
				<div className="grid gap-3">
					{instances.map(({ system, instance }) => (
						<InstanceCard
							key={`${system}${instance.name}`}
							system={system}
							instance={instance}
							showSystem={!systemId}
							onLog={(access) => setOpenLog({ system, instance: instance.name, access })}
						/>
					))}
					{!instances.length && (
						<p className="text-sm text-muted-foreground px-1">
							<Trans>No Traefik found on the systems that are up.</Trans>
						</p>
					)}
					{outdated > 0 && (
						<p className="text-xs text-muted-foreground px-1">
							<Plural
								value={outdated}
								one="# system needs an agent update (0.20.0-fork.6 or newer) to find its Traefik."
								other="# systems need an agent update (0.20.0-fork.6 or newer) to find their Traefik."
							/>
						</p>
					)}
				</div>
			)}
			<Dialog open={!!openLog} onOpenChange={(open) => !open && setOpenLog(null)}>
				{openLog && <TraefikLogDialog log={openLog} />}
			</Dialog>
		</Card>
	)
}

/** Columns the routes are sorted on */
type RouteSort = "router" | "address" | "container" | "certificate"

/** An instance: its state, links, resolvers and routes */
function InstanceCard({
	system,
	instance,
	showSystem,
	onLog,
}: {
	system: string
	instance: TraefikInstance
	showSystem: boolean
	onLog: (access: boolean) => void
}) {
	const systemRecord = useStore($allSystemsById)[system]
	const dashboard = traefikDashboard(instance, systemRecord?.host ?? "")
	const [sort, setSort] = useState<TableSort<RouteSort>>({ key: "router", desc: false })
	// widths of the columns resized by the user, shared by the instances
	const layout = useTableLayout("traefik-routes")
	const col = (id: RouteSort) => ({ style: cellWidthStyle(layout.widths[id]), ...resizedAttr(layout.widths[id]) })
	const routes = useMemo(() => {
		const text = (route: TraefikRoute) => {
			switch (sort.key) {
				case "address":
					return traefikRouteUrl(route).replace(/^https?:\/\//, "") || route.rule || ""
				case "container":
					return route.container || route.provider || ""
				case "certificate":
					return route.resolver ? `0${route.resolver}` : route.tls ? "1" : "2"
			}
			return route.router
		}
		const list = [...(instance.routes ?? [])].sort(
			(a, b) => text(a).localeCompare(text(b)) || a.router.localeCompare(b.router)
		)
		return sort.desc ? list.reverse() : list
	}, [instance.routes, sort])
	// the container of the instance, or its process when it runs as a service
	// the page of the host at its containers or processes, with the details of Traefik open
	const openInstance = () => {
		const section = instance.id ? "containers" : "processes"
		$openRequest.set(
			instance.id ? { kind: "container", name: instance.name, system } : { kind: "process", name: "traefik", system }
		)
		navigate(`${getPagePath($router, "system", { id: system })}#${section}`)
		// the page already shown gets the part asked by the hash
		announceSection(section)
	}
	const running = !instance.state || instance.state === "running"
	return (
		<div className="rounded-md border p-3 grid gap-3 min-w-0">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
				<span className={cn("size-2 rounded-full shrink-0", running ? "bg-green-500" : "bg-red-500")} />
				<span className="font-medium">{instance.name}</span>
				{instance.version && (
					<Badge variant="outline" className="font-normal">
						{instance.version}
					</Badge>
				)}
				{showSystem && systemRecord && (
					<Link
						href={getPagePath($router, "system", { id: system })}
						className="flex items-center gap-1 text-sm text-muted-foreground hover:underline"
					>
						<ServerIcon className="size-3.5" />
						{systemRecord.name}
					</Link>
				)}
				{instance.status && <span className="text-xs text-muted-foreground">{instance.status}</span>}
				<div className="flex flex-wrap gap-2 ms-auto">
					<Button variant="outline" size="sm" className="gap-1.5" onClick={openInstance}>
						{instance.id ? <ContainerIcon className="size-3.5" /> : <CpuIcon className="size-3.5" />}
						{instance.id ? <Trans>Container</Trans> : <Trans>Process</Trans>}
					</Button>
					{/* a disabled button gets no hover: its wrapper tells why */}
					<span
						className="inline-flex"
						title={dashboard || t`No dashboard found in the configuration of this instance.`}
					>
						<Button
							variant="outline"
							size="sm"
							className="gap-1.5"
							disabled={!dashboard}
							onClick={() => window.open(dashboard, "_blank", "noopener")}
						>
							<ExternalLinkIcon className="size-3.5" />
							<Trans>Dashboard</Trans>
						</Button>
					</span>
					<Button
						variant="outline"
						size="sm"
						className="gap-1.5"
						disabled={!instance.log}
						title={instance.log?.replace(/^file:/, "")}
						onClick={() => onLog(false)}
					>
						<ScrollTextIcon className="size-3.5" />
						<Trans>Logs</Trans>
					</Button>
					<span
						className="inline-flex"
						title={
							instance.accessLog
								? instance.accessLog.replace(/^file:/, "")
								: t`Access logs are not enabled on this instance.`
						}
					>
						<Button
							variant="outline"
							size="sm"
							className="gap-1.5"
							disabled={!instance.accessLog}
							onClick={() => onLog(true)}
						>
							<ScrollTextIcon className="size-3.5" />
							<Trans>Access logs</Trans>
						</Button>
					</span>
				</div>
			</div>
			{instance.error && <p className="text-xs text-destructive break-all">{instance.error}</p>}
			{(instance.resolvers ?? []).map((resolver) => {
				const resolverName = resolver.name
				const count = resolver.certificates ?? 0
				return (
					<div key={resolver.name} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm min-w-0">
						<LockIcon className="size-3.5 text-muted-foreground shrink-0" />
						<span>
							<Trans>Let's Encrypt resolver {resolverName}</Trans>
						</span>
						{resolver.error ? (
							<span className="text-xs text-destructive break-all">{resolver.error}</span>
						) : (
							<span className="text-muted-foreground">
								· <Plural value={count} one="# certificate" other="# certificates" />
							</span>
						)}
						{resolver.storage && (
							<span className="font-mono text-xs text-muted-foreground truncate" title={resolver.storage}>
								{resolver.storage}
							</span>
						)}
						<ReadAccessHint error={resolver.error} />
					</div>
				)
			})}
			{routes.length > 0 && (
				<div className="rounded-md border max-h-80 overflow-auto">
					<Table>
						<TableHeader>
							<TableRow>
								<SortableHead
									sortKey="router"
									sort={sort}
									onSort={setSort}
									width={layout.widths.router}
									onResize={layout.onColumnResize}
									Icon={WaypointsIcon}
								>
									<Trans>Router</Trans>
								</SortableHead>
								<SortableHead
									sortKey="address"
									sort={sort}
									onSort={setSort}
									width={layout.widths.address}
									onResize={layout.onColumnResize}
									Icon={GlobeIcon}
								>
									<Trans>Address</Trans>
								</SortableHead>
								<SortableHead
									sortKey="container"
									sort={sort}
									onSort={setSort}
									width={layout.widths.container}
									onResize={layout.onColumnResize}
									Icon={ContainerIcon}
								>
									<Trans>Container</Trans>
								</SortableHead>
								<SortableHead
									sortKey="certificate"
									sort={sort}
									onSort={setSort}
									width={layout.widths.certificate}
									onResize={layout.onColumnResize}
									Icon={LockIcon}
								>
									<Trans>Certificate</Trans>
								</SortableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{routes.map((route) => {
								const url = traefikRouteUrl(route)
								return (
									<TableRow key={`${route.provider}${route.router}`}>
										<TableCell className="py-1.5 max-w-48 truncate text-sm" title={route.rule} {...col("router")}>
											{route.router}
										</TableCell>
										<TableCell className="py-1.5 max-w-72" {...col("address")}>
											{url ? (
												<a
													href={url}
													target="_blank"
													rel="noreferrer"
													className="flex items-center gap-1.5 hover:underline min-w-0 text-sm"
												>
													<span className="truncate">{url.replace(/^https?:\/\//, "")}</span>
													<ExternalLinkIcon className="size-3 shrink-0 opacity-60" />
												</a>
											) : (
												<span className="text-xs text-muted-foreground truncate block" title={route.rule}>
													{route.rule}
												</span>
											)}
										</TableCell>
										<TableCell className="py-1.5 text-sm text-muted-foreground max-w-48 truncate" {...col("container")}>
											{route.container || (route.provider === "file" ? t`File` : "-")}
										</TableCell>
										<TableCell className="py-1.5 text-xs whitespace-nowrap" {...col("certificate")}>
											{route.resolver ? (
												<span className="rounded bg-muted px-1.5 py-0.5">Let's Encrypt · {route.resolver}</span>
											) : route.tls ? (
												"TLS"
											) : (
												<span className="text-muted-foreground">-</span>
											)}
										</TableCell>
									</TableRow>
								)
							})}
						</TableBody>
					</Table>
				</div>
			)}
		</div>
	)
}

/** The last lines of the log, or access log, of an instance, read from its host */
function TraefikLogDialog({ log }: { log: OpenLog }) {
	const [result, setResult] = useState<{ lines: string; source: string; error?: string }>()
	const [loading, setLoading] = useState(false)
	const read = useCallback(async () => {
		setLoading(true)
		try {
			setResult(await fetchTraefikLog(log.system, log.instance, log.access))
		} catch (e) {
			setResult({ lines: "", source: "", error: (e as Error).message })
		} finally {
			setLoading(false)
		}
	}, [log])
	useEffect(() => {
		read()
	}, [read])
	const instance = log.instance
	return (
		<DialogContent className="w-[calc(100vw-2rem)] max-w-5xl">
			<DialogHeader>
				<DialogTitle className="flex items-center gap-3 pe-6">
					{log.access ? <Trans>Access logs of {instance}</Trans> : <Trans>Logs of {instance}</Trans>}
					<Button
						variant="ghost"
						size="icon"
						className="size-7"
						onClick={read}
						disabled={loading}
						aria-label={t`Refresh`}
						title={t`Refresh`}
					>
						{loading ? <LoaderCircleIcon className="size-4 animate-spin" /> : <RefreshCwIcon className="size-4" />}
					</Button>
				</DialogTitle>
				<DialogDescription className="font-mono text-xs break-all">
					{result?.source === "stdout" ? <Trans>Output of the container</Trans> : result?.source}
				</DialogDescription>
			</DialogHeader>
			{result?.error ? (
				<p className="text-sm text-destructive">{result.error}</p>
			) : (
				<pre className="max-h-[65dvh] overflow-auto rounded-md bg-muted/50 p-3 text-xs leading-relaxed whitespace-pre">
					{result ? result.lines || t`No lines.` : ""}
				</pre>
			)}
		</DialogContent>
	)
}
