import { alertInfo, stateAlertHistoryInfo } from "@/lib/alerts"
import { $sensorAlerts, sensorAlertName } from "@/lib/sensor-alerts"
import { $sensorChecks, $sensors, checkName } from "@/lib/sensors"
import { $certificateAlerts } from "@/lib/certificates"
import { $stateAlerts, stateRuleAlertKind, triggeredTargets } from "@/lib/state-alerts"
import { $alerts, $allSystemsById, $userSettings } from "@/lib/stores"
import { queueUserSettings } from "@/lib/api"
import { cn } from "@/lib/utils"
import {
	ArrowDownWideNarrowIcon,
	ArrowUpNarrowWideIcon,
	CheckCheckIcon,
	CheckIcon,
	ClipboardListIcon,
	EyeIcon,
	EyeOffIcon,
	FileBadgeIcon,
	NetworkIcon,
	UndoIcon,
} from "lucide-react"
import { t } from "@lingui/core/macro"
import { Plural, Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { getPagePath } from "@nanostores/router"
import { type ReactNode, useMemo, useState } from "react"
import { announceSection } from "@/lib/linked-section"
import { describeRule } from "@/components/alerts/state-rule-fields"
import { $openRequest, type OpenRequest } from "@/lib/recent"
import type { StateAlertRecord } from "@/types"
import { $router, Link, navigate } from "./router"
import { Button } from "./ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog"
import { Input } from "./ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip"

/** An active alert of the panel: its card and the key of its current episode */
interface ActiveItem {
	/** changes when the alert triggers again, so an acknowledgement covers one episode only */
	key: string
	/** kind and subject of the alert, sorted and searched in the recap */
	kind: string
	subject: string
	/** other words found by the search of the recap */
	search: string
	/** last change of the alert, for the most recent first */
	since: string
	card: (acknowledged: boolean, onToggle: () => void) => ReactNode
}

/** Episode of an alert record: its id and the time of its last change */
const episodeKey = (record: { id: string; updated?: string }) => `${record.id}@${record.updated ?? ""}`

/** Keeps the acknowledgements of the active alerts only, and saves them */
function saveAcknowledged(keys: string[]) {
	$userSettings.setKey("ackAlerts", keys)
	queueUserSettings({ ackAlerts: keys })
}

/** Part of the host page showing a kind of state rule targets */
const ruleSection: Record<StateAlertRecord["kind"], string> = {
	service: "services",
	container: "containers",
	process: "processes",
}

/** Opens an object: its page, then its details once the page loaded it */
function openObject(href: string, request?: OpenRequest) {
	$openRequest.set(request ?? null)
	navigate(href)
	// the page already shown gets the part asked by the hash
	const hash = href.split("#")[1]
	if (hash) {
		announceSection(hash)
	}
}

/** Alerts shown on every page; the others are in the recap */
const maxCards = 4

/** Active alerts of all the systems and sensors, on top of every page */
export const ActiveAlerts = () => {
	const alerts = useStore($alerts)
	const stateAlerts = useStore($stateAlerts)
	const systems = useStore($allSystemsById)
	const sensorAlerts = useStore($sensorAlerts)
	const sensors = useStore($sensors)
	const sensorChecks = useStore($sensorChecks)
	const certificateAlerts = useStore($certificateAlerts)
	const acknowledged = useStore($userSettings).ackAlerts
	const [showAcknowledged, setShowAcknowledged] = useState(false)
	const [recapOpen, setRecapOpen] = useState(false)

	const items = useMemo(() => {
		const items: ActiveItem[] = []

		for (const systemId of Object.keys(alerts)) {
			for (const alert of alerts[systemId].values()) {
				if (!alert.triggered || !(alert.name in alertInfo)) {
					continue
				}
				const info = alertInfo[alert.name as keyof typeof alertInfo]
				items.push({
					key: episodeKey(alert),
					kind: info.name(),
					subject: systems[alert.system]?.name ?? "",
					search: alert.name,
					since: alert.updated ?? "",
					card: (ack, onToggle) => (
						<AlertCard
							key={alert.id}
							icon={<info.icon className="size-4" />}
							kind={info.name()}
							subject={systems[alert.system]?.name}
							href={getPagePath($router, "system", { id: alert.system })}
							acknowledged={ack}
							onToggle={onToggle}
						>
							{info.triggeredDesc ? (
								info.triggeredDesc()
							) : alert.name === "NetworkMonitorLoss" ? (
								<Trans>One or more monitors exceed {alert.value}% loss</Trans>
							) : alert.name === "Status" ? (
								<Trans>Connection is down</Trans>
							) : info.invert ? (
								<Trans>
									Below {alert.value}
									{info.unit} in last <Plural value={alert.min} one="# minute" other="# minutes" />
								</Trans>
							) : (
								<Trans>
									Exceeds {alert.value}
									{info.unit} in last <Plural value={alert.min} one="# minute" other="# minutes" />
								</Trans>
							)}
						</AlertCard>
					),
				})
			}
		}

		// service / container state rules with open incidents
		for (const rule of Object.values(stateAlerts)) {
			if (!rule.triggered) {
				continue
			}
			const targets = triggeredTargets(rule)
			const href = `${getPagePath($router, "system", { id: rule.system })}#${ruleSection[rule.kind]}`
			const open = (name?: string) =>
				openObject(href, name ? { kind: rule.kind, name, system: rule.system } : undefined)
			const info = stateAlertHistoryInfo[stateRuleAlertKind(rule.kind)]
			const Icon = info.icon
			items.push({
				// the rule is saved on each check: its episode is the open incident of each target
				key: `${rule.id}:${targets.map((name) => rule.state?.t?.[name]?.h).join()}`,
				kind: info.name(),
				subject: systems[rule.system]?.name ?? "",
				search: `${rule.name ?? ""} ${describeRule(rule)} ${targets.join(" ")}`,
				since: rule.updated ?? "",
				card: (ack, onToggle) => (
					<AlertCard
						key={rule.id}
						icon={<Icon className="size-4" />}
						kind={info.name()}
						subject={systems[rule.system]?.name}
						href={href}
						onOpen={() => open(targets[0])}
						acknowledged={ack}
						onToggle={onToggle}
					>
						<span className="block truncate first-letter:uppercase">{describeRule(rule)}</span>
						{targets.length > 0 && <TargetChips names={targets} onOpen={open} />}
					</AlertCard>
				),
			})
		}

		// alerts of the network sensors
		for (const alert of Object.values(sensorAlerts)) {
			if (!alert.triggered) {
				continue
			}
			const sensor = sensors[alert.sensor]
			const ports = (alert.checks ?? [])
				.map((id) => sensorChecks[id])
				.filter((check) => check && check.status === "down")
				.map((check) => checkName(check))
			items.push({
				key: episodeKey(alert),
				kind: sensorAlertName(alert.name),
				subject: sensor?.name ?? "",
				search: `${sensor?.host ?? ""} ${ports.join(" ")}`,
				since: alert.updated ?? "",
				card: (ack, onToggle) => (
					<AlertCard
						key={alert.id}
						icon={<NetworkIcon className="size-4" />}
						kind={sensorAlertName(alert.name)}
						subject={sensor?.name}
						href={getPagePath($router, "sensor", { id: alert.sensor })}
						acknowledged={ack}
						onToggle={onToggle}
					>
						{alert.name === "port" && ports.length ? <TargetChips names={ports} /> : sensor?.host}
					</AlertCard>
				),
			})
		}

		// expiry alerts of the certificates of the hosts
		for (const alert of Object.values(certificateAlerts)) {
			if (!alert.triggered) {
				continue
			}
			const certificate = { kind: "certificate" as const, name: alert.name, system: alert.system }
			const days = alert.days
			const name = alert.name
			items.push({
				key: `${alert.id}:${alert.history}`,
				kind: t`Certificate expiry`,
				subject: systems[alert.system]?.name ?? "",
				search: alert.name,
				since: alert.updated ?? "",
				card: (ack, onToggle) => (
					<AlertCard
						key={alert.id}
						icon={<FileBadgeIcon className="size-4" />}
						kind={<Trans>Certificate expiry</Trans>}
						subject={systems[alert.system]?.name}
						href={getPagePath($router, "certificates")}
						onOpen={() => openObject(getPagePath($router, "certificates"), certificate)}
						acknowledged={ack}
						onToggle={onToggle}
					>
						<Trans>
							{name} expires in less than {days} days
						</Trans>
					</AlertCard>
				),
			})
		}
		return items
	}, [alerts, stateAlerts, sensorAlerts, sensors, sensorChecks, systems, certificateAlerts])

	if (!items.length) {
		return null
	}

	// acknowledgements of the alerts still active; the others are dropped on the next change
	const activeKeys = new Set(items.map((item) => item.key))
	const ackKeys = new Set((acknowledged ?? []).filter((key) => activeKeys.has(key)))
	const toggle = (key: string) => {
		const next = new Set(ackKeys)
		if (next.has(key)) next.delete(key)
		else next.add(key)
		saveAcknowledged([...next])
	}
	const pending = items.filter((item) => !ackKeys.has(item.key))
	const ackCount = items.length - pending.length
	const shown = showAcknowledged ? items : pending
	// the first ones on every page, all of them in the recap
	const visible = shown.slice(0, maxCards)
	const moreCount = shown.length - visible.length
	const count = items.length
	const recap = (
		<Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setRecapOpen(true)}>
			<ClipboardListIcon className="size-4" />
			<Trans>Recap</Trans>
		</Button>
	)
	const recapDialog = (
		<Dialog open={recapOpen} onOpenChange={setRecapOpen}>
			{recapOpen && <AlertsRecap items={items} ackKeys={ackKeys} onToggle={toggle} />}
		</Dialog>
	)

	// all acknowledged and hidden: a discreet line
	if (!shown.length) {
		return (
			<Card className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
				<CheckCheckIcon className="size-4" />
				<Plural value={ackCount} one="# active alert acknowledged" other="# active alerts acknowledged" />
				<Button variant="ghost" size="sm" className="h-7 gap-1.5 ms-auto" onClick={() => setShowAcknowledged(true)}>
					<EyeIcon className="size-4" />
					<Trans>Show</Trans>
				</Button>
				{recap}
				{recapDialog}
			</Card>
		)
	}

	return (
		<Card className="border-red-500/60 bg-red-500/5 dark:bg-red-500/10">
			<CardHeader className="pt-4 pb-4 px-2 sm:px-6 max-sm:pt-3 max-sm:pb-1">
				<div className="px-2 sm:px-1 flex flex-wrap items-center gap-2">
					<CardTitle className="text-red-600 dark:text-red-400">
						<Plural value={count} one="Active alert" other="# active alerts" />
					</CardTitle>
					{moreCount > 0 && (
						<button
							type="button"
							className="text-sm text-muted-foreground hover:text-foreground hover:underline underline-offset-2"
							onClick={() => setRecapOpen(true)}
						>
							<Plural value={moreCount} one="+ # more alert" other="+ # more alerts" />
						</button>
					)}
					<span className="me-auto" />
					{ackCount > 0 && (
						<Button
							variant="ghost"
							size="sm"
							className="h-8 gap-1.5 text-muted-foreground"
							onClick={() => setShowAcknowledged((value) => !value)}
						>
							{showAcknowledged ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
							{showAcknowledged ? (
								<Trans>Hide acknowledged</Trans>
							) : (
								<Plural value={ackCount} one="Show # acknowledged" other="Show # acknowledged" />
							)}
						</Button>
					)}
					{pending.length > 0 && (
						<Button
							variant="outline"
							size="sm"
							className="h-8 gap-1.5"
							onClick={() => saveAcknowledged([...ackKeys, ...pending.map((item) => item.key)])}
						>
							<CheckCheckIcon className="size-4" />
							<Trans>Acknowledge all</Trans>
						</Button>
					)}
					{recap}
				</div>
			</CardHeader>
			<CardContent className="max-sm:p-2">
				<div className="grid sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
					{visible.map((item) => item.card(ackKeys.has(item.key), () => toggle(item.key)))}
				</div>
			</CardContent>
			{recapDialog}
		</Card>
	)
}

/** Orders of the recap of the alerts */
type RecapSort = "recent" | "kind" | "subject"

/**
 * All the active alerts in a dialog, acknowledged ones included: searched,
 * sorted by their last change, kind or subject, each one acknowledged or not.
 */
function AlertsRecap({
	items,
	ackKeys,
	onToggle,
}: {
	items: ActiveItem[]
	ackKeys: Set<string>
	onToggle: (key: string) => void
}) {
	const [query, setQuery] = useState("")
	const [sort, setSort] = useState<RecapSort>("recent")
	// a second click on the sort in use reverses it
	const [reversed, setReversed] = useState(false)
	const terms = query.toLowerCase().split(" ").filter(Boolean)
	const list = items
		.filter((item) => {
			const text = `${item.kind} ${item.subject} ${item.search}`.toLowerCase()
			return terms.every((term) => text.includes(term))
		})
		.sort((a, b) => {
			const order = (() => {
				switch (sort) {
					case "kind":
						return a.kind.localeCompare(b.kind) || a.subject.localeCompare(b.subject)
					case "subject":
						return a.subject.localeCompare(b.subject) || a.kind.localeCompare(b.kind)
				}
				return b.since.localeCompare(a.since)
			})()
			return reversed ? -order : order
		})
	const count = items.length
	const pendingKeys = items.filter((item) => !ackKeys.has(item.key)).map((item) => item.key)
	const sorts: { value: RecapSort; label: string }[] = [
		{ value: "recent", label: t`Most recent` },
		{ value: "kind", label: t`Type` },
		{ value: "subject", label: t`Name` },
	]
	return (
		<DialogContent className="w-[calc(100vw-2rem)] max-w-5xl max-h-[calc(100dvh-2rem)] flex flex-col">
			<DialogHeader>
				<DialogTitle className="text-red-600 dark:text-red-400">
					<Plural value={count} one="Active alert" other="# active alerts" />
				</DialogTitle>
				<DialogDescription>
					<Trans>All the active alerts, acknowledged ones included.</Trans>
				</DialogDescription>
			</DialogHeader>
			<div className="flex flex-wrap items-center gap-2">
				<Input
					placeholder={t`Filter...`}
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					className="flex-1 min-w-48"
				/>
				<div className="flex rounded-md border p-0.5 gap-0.5">
					{sorts.map((option) => (
						<Button
							key={option.value}
							variant={sort === option.value ? "secondary" : "ghost"}
							size="sm"
							className="h-8 gap-1.5"
							onClick={() => {
								setReversed(sort === option.value ? !reversed : false)
								setSort(option.value)
							}}
						>
							{sort === option.value &&
								(reversed ? (
									<ArrowUpNarrowWideIcon className="size-3.5" />
								) : (
									<ArrowDownWideNarrowIcon className="size-3.5" />
								))}
							{option.label}
						</Button>
					))}
				</div>
				{pendingKeys.length > 0 && (
					<Button
						variant="outline"
						size="sm"
						className="h-9 gap-1.5"
						onClick={() => saveAcknowledged([...ackKeys, ...pendingKeys])}
					>
						<CheckCheckIcon className="size-4" />
						<Trans>Acknowledge all</Trans>
					</Button>
				)}
			</div>
			<div className="grid sm:grid-cols-2 gap-3 overflow-y-auto min-h-0 pe-1 -me-1 py-0.5">
				{list.map((item) => item.card(ackKeys.has(item.key), () => onToggle(item.key)))}
				{!list.length && (
					<p className="text-sm text-muted-foreground py-6 text-center sm:col-span-2">
						<Trans>No alerts match the filter.</Trans>
					</p>
				)}
			</div>
		</DialogContent>
	)
}

/** Names shown as chips in an alert card: the first ones, then the number of the others */
function TargetChips({ names, onOpen }: { names: string[]; onOpen?: (name: string) => void }) {
	const shown = names.slice(0, 3)
	const more = names.length - shown.length
	return (
		<span className="relative z-10 flex flex-wrap gap-1 mt-0.5" title={names.join(", ")}>
			{shown.map((name) =>
				onOpen ? (
					<button
						type="button"
						key={name}
						onClick={() => onOpen(name)}
						className="max-w-full truncate rounded border bg-muted/60 px-1.5 text-xs leading-5 text-foreground/90 hover:bg-accent hover:border-foreground/30"
					>
						{name}
					</button>
				) : (
					<span key={name} className="max-w-full truncate rounded border bg-muted/60 px-1.5 text-xs leading-5 text-foreground/90">
						{name}
					</span>
				)
			)}
			{more > 0 && <span className="text-xs leading-5 text-muted-foreground">+{more}</span>}
		</span>
	)
}

/**
 * Card of an active alert: the kind of alert, what it is about and its details
 * on their own lines. The card links to its system or sensor, and has its
 * acknowledge button.
 */
function AlertCard({
	icon,
	kind,
	subject,
	href,
	onOpen,
	acknowledged,
	onToggle,
	children,
}: {
	icon: ReactNode
	kind: ReactNode
	subject: ReactNode
	href: string
	/** opens the object of the alert instead of following href */
	onOpen?: () => void
	acknowledged: boolean
	onToggle: () => void
	children: ReactNode
}) {
	const label = acknowledged ? t`Cancel the acknowledgement` : t`Acknowledge`
	return (
		<div className={cn("group relative duration-200 hover:-translate-y-px", acknowledged && "opacity-60")}>
			<div
				role="alert"
				className={cn(
					"h-full flex gap-3 rounded-lg border bg-background ps-3 pe-11 py-2.5 shadow-black/5 transition-shadow hover:shadow-md",
					acknowledged ? "border-border" : "border-red-500/60"
				)}
			>
				<div
					className={cn(
						"mt-0.5 grid size-8 shrink-0 place-items-center rounded-md",
						acknowledged ? "bg-muted text-muted-foreground" : "bg-red-500/10 text-red-600 dark:text-red-400"
					)}
				>
					{icon}
				</div>
				<div className="grid min-w-0 content-start gap-0.5">
					<span
						className={cn(
							"truncate text-[0.7rem] font-semibold uppercase tracking-wide",
							acknowledged ? "text-muted-foreground" : "text-red-600 dark:text-red-400"
						)}
					>
						{kind}
					</span>
					<span className="truncate font-semibold leading-snug group-hover:underline underline-offset-2">{subject}</span>
					<div className="text-sm leading-snug text-muted-foreground line-clamp-2 break-words">{children}</div>
				</div>
				{onOpen ? (
					<button
						type="button"
						className="absolute inset-0 w-full h-full rounded-lg cursor-pointer"
						aria-label={t`View`}
						onClick={onOpen}
					/>
				) : (
					<Link href={href} className="absolute inset-0 w-full h-full rounded-lg" aria-label={t`View`}></Link>
				)}
			</div>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						className="absolute top-2 end-2 z-10 size-8 text-muted-foreground hover:text-foreground"
						aria-label={label}
						onClick={onToggle}
					>
						{acknowledged ? <UndoIcon className="size-4" /> : <CheckIcon className="size-4" />}
					</Button>
				</TooltipTrigger>
				<TooltipContent>{label}</TooltipContent>
			</Tooltip>
		</div>
	)
}
