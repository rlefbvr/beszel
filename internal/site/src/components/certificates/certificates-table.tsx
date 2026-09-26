import { t } from "@lingui/core/macro"
import { Plural, Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { getPagePath } from "@nanostores/router"
import {
	ArrowUpDownIcon,
	BadgeCheckIcon,
	BellIcon,
	BellRingIcon,
	CalendarClockIcon,
	ClipboardListIcon,
	FilterIcon,
	Settings2Icon,
	TableIcon,
	CopyIcon,
	FileBadgeIcon,
	FolderIcon,
	LayersIcon,
	LoaderCircleIcon,
	NetworkIcon,
	PlusIcon,
	RefreshCwIcon,
	ServerIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { CertDetails, Muted, Row } from "@/components/sensors/sensor-cert"
import { type ImportantTile, ImportantTargets } from "@/components/important-targets"
import { $router, Link } from "@/components/router"
import { sameHost } from "@/components/sensors/host-links"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/use-toast"
import { isReadOnlyUser, pb, queueUserSettings } from "@/lib/api"
import {
	$certificateAlerts,
	$certificatePaths,
	$certificates,
	certificateAlertOf,
	certificateDaysLeft,
	type CertificateStep,
	certificateUseSteps,
	certificateUseLabel,
	defaultCertificateAlertDays,
} from "@/lib/certificates"
import { $openRequest, rememberRecent } from "@/lib/recent"
import { $checksBySensor, $sensors, checkName } from "@/lib/sensors"
import { $allSystemsById, $userSettings } from "@/lib/stores"
import { formatDateTime, useNow } from "@/lib/time"
import { cn, copyToClipboard } from "@/lib/utils"
import type { CertificateAlertRecord, CertificateRecord, UserSettings } from "@/types"
import { GuardedDialog } from "@/components/discard-guard"

/** Days before expiry when a certificate shows as expiring */
const expiringDays = 30

type Sort = NonNullable<UserSettings["certificatesSort"]>
type Status = NonNullable<UserSettings["certificatesStatus"]>

/** Columns that can be hidden, with their header */
const optionalColumns = {
	system: () => t`System`,
	expiry: () => t`Expires`,
	issuer: () => t`Issued by`,
	uses: () => t`Used by`,
	location: () => t`Location`,
}
type OptionalColumn = keyof typeof optionalColumns

/** Saves a display setting of the table for the user */
function saveSetting<K extends keyof UserSettings>(key: K, value: UserSettings[K]) {
	$userSettings.setKey(key, value)
	queueUserSettings({ [key]: value })
}

/** State of a certificate for the status filter */
function certificateStatus(cert: CertificateRecord, now: Date): Exclude<Status, "all"> {
	const days = certificateDaysLeft(cert, now)
	if (cert.error || days === null) {
		return "error"
	}
	return days < 0 ? "expired" : days <= expiringDays ? "expiring" : "valid"
}

/** Common name of a distinguished name, such as R11 in CN=R11,O=Let's Encrypt,C=US */
function commonName(dn: string) {
	return /(?:^|,)\s*CN=([^,]+)/.exec(dn)?.[1] ?? dn
}

/** Color of the days left: red once expired, orange when expiring, green otherwise */
function daysClass(days: number | null) {
	if (days === null) {
		return "bg-muted text-muted-foreground"
	}
	if (days < 0) {
		return "bg-red-500/15 text-red-700 dark:text-red-400"
	}
	if (days <= expiringDays) {
		return "bg-orange-500/15 text-orange-700 dark:text-orange-400"
	}
	return "bg-green-500/15 text-green-700 dark:text-green-400"
}

function DaysLeft({ days }: { days: number | null }) {
	return (
		<span className={cn("rounded px-1.5 py-0.5 text-xs font-medium tabular-nums whitespace-nowrap", daysClass(days))}>
			{days === null ? "-" : days < 0 ? <Trans>Expired</Trans> : <Plural value={days} one="# day" other="# days" />}
		</span>
	)
}

/** HTTPS checks of the sensors of the host of a certificate that see the same certificate */
function useSensorLinks() {
	const sensors = useStore($sensors)
	const checksBySensor = useStore($checksBySensor)
	const systems = useStore($allSystemsById)
	return (cert: CertificateRecord) => {
		const host = systems[cert.system]?.host
		if (!host || !cert.fingerprint) {
			return []
		}
		return Object.values(sensors)
			.filter((sensor) => sameHost(sensor.host, host))
			.flatMap((sensor) =>
				(checksBySensor[sensor.id] ?? [])
					.filter((check) => check.cert?.sha256?.toLowerCase() === cert.fingerprint.toLowerCase())
					.map((check) => ({ sensor, check }))
			)
	}
}

/** All the certificates of the hosts, with the important ones (with an expiry alert) first */
export default function CertificatesTable() {
	const certificates = useStore($certificates)
	const alerts = useStore($certificateAlerts)
	const systems = useStore($allSystemsById)
	useStore($certificatePaths)
	const now = useNow()
	const sensorLinks = useSensorLinks()
	const readOnly = isReadOnlyUser()
	const [filter, setFilter] = useState("")
	const settings = useStore($userSettings)
	const sort = settings.certificatesSort ?? "expiry"
	const desc = settings.certificatesSortDesc ?? false
	const status = settings.certificatesStatus ?? "all"
	const hidden = settings.certificatesHidden ?? []
	const show = (column: OptionalColumn) => !hidden.includes(column)
	/** sorts on a column, or reverses the order when it is already sorted on it */
	const setSort = (value: Sort) => {
		if (value === sort) {
			saveSetting("certificatesSortDesc", !desc)
		} else {
			saveSetting("certificatesSort", value)
			saveSetting("certificatesSortDesc", false)
		}
	}
	const [selected, setSelectedState] = useState<CertificateRecord | null>(null)
	/** opens the details of a certificate, remembered in the recent objects of the command palette */
	const setSelected = useCallback((cert: CertificateRecord | null) => {
		setSelectedState(cert)
		if (cert) {
			rememberRecent({ kind: "certificate", id: cert.id, name: cert.name, system: cert.system })
		}
	}, [])
	// a certificate chosen in the command palette opens once the list is loaded
	const openRequest = useStore($openRequest)
	useEffect(() => {
		const cert = openRequest?.kind === "certificate" && certificates[openRequest.id]
		if (cert) {
			$openRequest.set(null)
			setSelected(cert)
		}
	}, [openRequest, certificates, setSelected])
	const [alerting, setAlerting] = useState<CertificateRecord | null>(null)
	const [addOpen, setAddOpen] = useState(false)
	const [recapOpen, setRecapOpen] = useState(false)
	const [refreshing, setRefreshing] = useState(false)

	const all = useMemo(() => {
		const days = (cert: CertificateRecord) => certificateDaysLeft(cert, now) ?? Number.MAX_SAFE_INTEGER
		const systemName = (cert: CertificateRecord) => systems[cert.system]?.name ?? ""
		const uses = (cert: CertificateRecord) => (cert.uses ?? []).map(certificateUseLabel).join(", ")
		const compare = (a: CertificateRecord, b: CertificateRecord) => {
			switch (sort) {
				case "name":
					return a.name.localeCompare(b.name) || systemName(a).localeCompare(systemName(b))
				case "system":
					return systemName(a).localeCompare(systemName(b)) || days(a) - days(b)
				case "issuer":
					return commonName(a.issuer).localeCompare(commonName(b.issuer)) || a.name.localeCompare(b.name)
				case "uses":
					return uses(a).localeCompare(uses(b)) || a.name.localeCompare(b.name)
				case "location":
					return a.path.localeCompare(b.path)
			}
			return days(a) - days(b) || a.name.localeCompare(b.name)
		}
		return Object.values(certificates).sort((a, b) => (desc ? compare(b, a) : compare(a, b)))
	}, [certificates, systems, sort, desc, now])

	const shown = useMemo(() => {
		const terms = filter.toLowerCase().split(" ").filter(Boolean)
		return all.filter((cert) => {
			if (status !== "all" && certificateStatus(cert, now) !== status) {
				return false
			}
			if (!terms.length) {
				return true
			}
			const uses = (cert.uses ?? []).map((use) => `${certificateUseLabel(use)} ${use.location} ${use.detail}`).join(" ")
			const text =
				`${cert.name} ${(cert.names ?? []).join(" ")} ${systems[cert.system]?.name} ${cert.issuer} ${cert.path} ${uses}`.toLowerCase()
			return terms.every((term) => text.includes(term))
		})
	}, [all, filter, systems, status, now])

	/** certificates with an expiry alert of the user */
	const important = useMemo(() => all.filter((cert) => certificateAlertOf(alerts, cert)), [all, alerts])
	const expiring = all.filter((cert) => {
		const days = certificateDaysLeft(cert, now)
		return days !== null && days >= 0 && days <= expiringDays
	}).length
	const expired = all.filter((cert) => (certificateDaysLeft(cert, now) ?? 0) < 0).length

	const tiles = important.map((cert): ImportantTile => {
		const alert = certificateAlertOf(alerts, cert) as CertificateAlertRecord
		const days = certificateDaysLeft(cert, now)
		return {
			key: cert.id,
			name: cert.name,
			systemName: systems[cert.system]?.name,
			dotClass:
				days === null
					? "bg-muted-foreground"
					: days < 0
						? "bg-red-500"
						: days <= alert.days
							? "bg-orange-500"
							: "bg-green-500",
			status:
				days === null ? (
					cert.error
				) : days < 0 ? (
					<Trans>Expired</Trans>
				) : (
					<Plural value={days} one="Expires in # day" other="Expires in # days" />
				),
			triggered: alert.triggered,
			onClick: () => setSelected(cert),
			onRemove: () => removeAlert(alert),
			removeDescription: <Trans>Its expiry alert is deleted: no notification is sent before it expires.</Trans>,
		}
	})

	async function refreshAll() {
		setRefreshing(true)
		const ids = [...new Set([...Object.keys(systems)])]
		let outdated = 0
		await Promise.all(
			ids.map(async (system) => {
				try {
					await pb.send("/api/beszel/certificates/refresh", { method: "POST", query: { system }, requestKey: null })
				} catch (e) {
					if (/^outdated/i.test((e as Error).message)) {
						outdated++
					}
				}
			})
		)
		setRefreshing(false)
		toast({
			title: t`Certificates read`,
			description: outdated ? t`${outdated} system(s) need an agent update to read their certificates.` : undefined,
		})
	}

	return (
		<Card className="@container w-full px-3 py-5 sm:py-6 sm:px-6">
			<CardHeader className="p-0 mb-3 sm:mb-4">
				<div className="grid md:flex gap-x-5 gap-y-3 w-full items-end">
					<div className="px-2 sm:px-1">
						<CardTitle className="mb-2">
							<Trans>All certificates</Trans>
						</CardTitle>
						<div className="text-sm text-muted-foreground flex items-center flex-wrap">
							<Trans>Total: {all.length}</Trans>
							<Separator orientation="vertical" className="h-4 mx-2 bg-primary/40" />
							<Trans>Expiring: {expiring}</Trans>
							<Separator orientation="vertical" className="h-4 mx-2 bg-primary/40" />
							<Trans>Expired: {expired}</Trans>
						</div>
					</div>
					<div className="flex flex-wrap gap-2 ms-auto w-full md:w-auto">
						<div className="relative flex-1 md:w-56">
							<Input
								placeholder={t`Filter...`}
								value={filter}
								onChange={(e) => setFilter(e.target.value)}
								className="ps-4 pe-10 w-full"
							/>
							{filter && (
								<Button
									type="button"
									variant="ghost"
									size="icon"
									aria-label={t`Clear`}
									className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground"
									onClick={() => setFilter("")}
								>
									<XIcon className="h-4 w-4" />
								</Button>
							)}
						</div>
						<ViewMenu sort={sort} status={status} hidden={hidden} onSort={setSort} />
						<Button variant="outline" className="gap-1.5" onClick={refreshAll} disabled={refreshing}>
							{refreshing ? <LoaderCircleIcon className="size-4 animate-spin" /> : <RefreshCwIcon className="size-4" />}
							<Trans>Read now</Trans>
						</Button>
						<Button
							variant="outline"
							className="gap-1.5"
							onClick={() => setRecapOpen(true)}
							disabled={!important.length}
						>
							<ClipboardListIcon className="size-4" />
							<Trans>Recap</Trans>
						</Button>
						{!readOnly && (
							<Button variant="outline" className="gap-1.5" onClick={() => setAddOpen(true)}>
								<PlusIcon className="size-4" />
								<Trans>Add a certificate</Trans>
							</Button>
						)}
					</div>
				</div>
			</CardHeader>

			<ImportantTargets
				title={<Trans>Important certificates</Trans>}
				subtitle={<Trans>With an expiry alert</Trans>}
				tiles={tiles}
			/>

			<div className="rounded-md border overflow-x-auto">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-10 px-2">
								<span className="h-9 px-3 flex items-center" title={t`Expiry alert`}>
									<BellIcon className="size-4" />
								</span>
							</TableHead>
							<SortHead sort={sort} value="name" onSort={setSort} Icon={FileBadgeIcon} name={t`Name`} />
							{show("system") && (
								<SortHead sort={sort} value="system" onSort={setSort} Icon={ServerIcon} name={t`System`} />
							)}
							{show("expiry") && (
								<SortHead sort={sort} value="expiry" onSort={setSort} Icon={CalendarClockIcon} name={t`Expires`} />
							)}
							{show("issuer") && (
								<SortHead sort={sort} value="issuer" onSort={setSort} Icon={BadgeCheckIcon} name={t`Issued by`} />
							)}
							{show("uses") && (
								<SortHead sort={sort} value="uses" onSort={setSort} Icon={LayersIcon} name={t`Used by`} />
							)}
							{show("location") && (
								<SortHead sort={sort} value="location" onSort={setSort} Icon={FolderIcon} name={t`Location`} />
							)}
						</TableRow>
					</TableHeader>
					<TableBody>
						{shown.map((cert) => {
							const alert = certificateAlertOf(alerts, cert)
							const alertDays = alert?.days ?? 0
							const days = certificateDaysLeft(cert, now)
							const links = sensorLinks(cert)
							return (
								<TableRow key={cert.id} className="cursor-pointer" onClick={() => setSelected(cert)}>
									<TableCell className="py-2">
										<Button
											variant="ghost"
											size="icon"
											className={cn("size-8", alert ? "text-primary" : "text-muted-foreground")}
											aria-label={t`Expiry alert`}
											title={alert ? t`Expiry alert: ${alertDays} days` : t`Expiry alert`}
											disabled={readOnly}
											onClick={(e) => {
												e.stopPropagation()
												setAlerting(cert)
											}}
										>
											{alert ? <BellRingIcon className="size-4" /> : <BellIcon className="size-4" />}
										</Button>
									</TableCell>
									<TableCell className="py-2 max-w-72">
										<div className="font-medium truncate" title={(cert.names ?? []).join(", ")}>
											{cert.name}
										</div>
										<div className="flex flex-wrap gap-1 mt-0.5">
											{cert.self_signed && (
												<Badge variant="outline" className="text-[0.7rem] px-1.5 py-0">
													<Trans>Self-signed</Trans>
												</Badge>
											)}
											{cert.custom && (
												<Badge variant="outline" className="text-[0.7rem] px-1.5 py-0">
													<Trans>Added</Trans>
												</Badge>
											)}
											{links.length > 0 && (
												<Badge variant="outline" className="text-[0.7rem] px-1.5 py-0 gap-1">
													<NetworkIcon className="size-3" />
													<Trans>Seen by a sensor</Trans>
												</Badge>
											)}
										</div>
									</TableCell>
									{show("system") && (
										<TableCell className="py-2 whitespace-nowrap">
											{systems[cert.system]?.name ?? cert.system}
										</TableCell>
									)}
									{show("expiry") && (
										<TableCell className="py-2 whitespace-nowrap">
											{cert.error ? (
												<span className="text-xs text-destructive">{cert.error}</span>
											) : (
												<span className="flex items-center gap-2">
													<DaysLeft days={days} />
													<span className="text-xs text-muted-foreground tabular-nums">
														{cert.not_after && formatDateTime(cert.not_after).split(" ")[0]}
													</span>
												</span>
											)}
										</TableCell>
									)}
									{show("issuer") && (
										<TableCell className="py-2 max-w-48 truncate text-sm" title={cert.issuer}>
											{commonName(cert.issuer)}
										</TableCell>
									)}
									{show("uses") && (
										<TableCell className="py-2">
											<div className="flex flex-wrap gap-1">
												{[...new Set((cert.uses ?? []).map(certificateUseLabel))].map((label) => (
													<span key={label} className="rounded bg-muted px-1.5 py-0.5 text-xs whitespace-nowrap">
														{label}
													</span>
												))}
											</div>
										</TableCell>
									)}
									{show("location") && (
										<TableCell
											className="py-2 max-w-72 truncate font-mono text-xs text-muted-foreground"
											title={cert.path}
										>
											{cert.path}
										</TableCell>
									)}
								</TableRow>
							)
						})}
						{!shown.length && (
							<TableRow>
								<TableCell
									colSpan={2 + Object.keys(optionalColumns).length - hidden.length}
									className="h-24 text-center text-muted-foreground"
								>
									{all.length ? (
										<Trans>No certificates match the filter.</Trans>
									) : (
										<Trans>
											No certificates yet. The agents (0.20.0-fork.5 or newer) read the certificates of their host every
											6 hours.
										</Trans>
									)}
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>

			<Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
				{selected && (
					<CertificateDialog
						cert={certificates[selected.id] ?? selected}
						onAlert={() => setAlerting(selected)}
						onClose={() => setSelected(null)}
					/>
				)}
			</Dialog>
			<Dialog open={!!alerting} onOpenChange={(open) => !open && setAlerting(null)}>
				{alerting && <CertificateAlertDialog cert={alerting} onClose={() => setAlerting(null)} />}
			</Dialog>
			<GuardedDialog open={addOpen} onOpenChange={setAddOpen}>
				{addOpen && <AddCertificateDialog onClose={() => setAddOpen(false)} />}
			</GuardedDialog>
			<Dialog open={recapOpen} onOpenChange={setRecapOpen}>
				{recapOpen && <RecapDialog certs={important} />}
			</Dialog>
		</Card>
	)
}

/** Sortable column header, like the other tables: icon, name and sort arrow */
function SortHead({
	sort,
	value,
	onSort,
	Icon,
	name,
}: {
	sort: Sort
	value: Sort
	onSort: (sort: Sort) => void
	Icon: React.ElementType
	name: string
}) {
	return (
		<TableHead className="px-2">
			<Button
				variant="ghost"
				className={cn(
					"h-9 px-3 flex items-center gap-2 duration-50",
					sort === value && "bg-accent/70 light:bg-accent text-accent-foreground/90"
				)}
				onClick={() => onSort(value)}
			>
				<Icon className="size-4" />
				{name}
				<ArrowUpDownIcon className="size-4" />
			</Button>
		</TableHead>
	)
}

/** View menu of the table: sort, status filter and visible columns */
function ViewMenu({
	sort,
	status,
	hidden,
	onSort,
}: {
	sort: Sort
	status: Status
	hidden: string[]
	onSort: (sort: Sort) => void
}) {
	const { expiry, ...otherColumns } = optionalColumns
	const sorts: Record<Sort, () => string> = { expiry, name: () => t`Name`, ...otherColumns }
	const statuses: Record<Status, () => string> = {
		all: () => t`All`,
		valid: () => t`Valid`,
		expiring: () => t`Expiring soon`,
		expired: () => t`Expired`,
		error: () => t`Unreadable`,
	}
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" className="shrink-0">
					<Settings2Icon className="me-1.5 size-4 opacity-80" />
					<Trans>View</Trans>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="max-h-[70dvh] overflow-y-auto">
				<div className="grid md:grid-cols-3 divide-y md:divide-y-0 md:divide-x">
					<div>
						<DropdownMenuLabel className="pt-2 px-3.5 flex items-center gap-2">
							<ArrowUpDownIcon className="size-4" />
							<Trans>Sort By</Trans>
						</DropdownMenuLabel>
						<DropdownMenuSeparator />
						<DropdownMenuRadioGroup className="px-1 pb-1" value={sort} onValueChange={(value) => onSort(value as Sort)}>
							{(Object.keys(sorts) as Sort[]).map((value) => (
								<DropdownMenuRadioItem key={value} value={value} onSelect={(e) => e.preventDefault()}>
									{sorts[value]()}
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</div>
					<div>
						<DropdownMenuLabel className="pt-2 px-3.5 flex items-center gap-2">
							<FilterIcon className="size-4" />
							<Trans>Status</Trans>
						</DropdownMenuLabel>
						<DropdownMenuSeparator />
						<DropdownMenuRadioGroup
							className="px-1 pb-1"
							value={status}
							onValueChange={(value) => saveSetting("certificatesStatus", value as Status)}
						>
							{(Object.keys(statuses) as Status[]).map((value) => (
								<DropdownMenuRadioItem key={value} value={value} onSelect={(e) => e.preventDefault()}>
									{statuses[value]()}
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</div>
					<div>
						<DropdownMenuLabel className="pt-2 px-3.5 flex items-center gap-2">
							<TableIcon className="size-4" />
							<Trans>Columns</Trans>
						</DropdownMenuLabel>
						<DropdownMenuSeparator />
						<div className="px-1.5 pb-1">
							{(Object.keys(optionalColumns) as OptionalColumn[]).map((column) => (
								<DropdownMenuCheckboxItem
									key={column}
									onSelect={(e) => e.preventDefault()}
									checked={!hidden.includes(column)}
									onCheckedChange={(visible) =>
										saveSetting(
											"certificatesHidden",
											visible ? hidden.filter((c) => c !== column) : [...hidden.filter((c) => c !== column), column]
										)
									}
								>
									{optionalColumns[column]()}
								</DropdownMenuCheckboxItem>
							))}
						</div>
					</div>
				</div>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

async function removeAlert(alert: CertificateAlertRecord) {
	try {
		await pb.collection("certificate_alerts").delete(alert.id)
	} catch (e) {
		toast({ variant: "destructive", title: t`Error`, description: (e as Error).message })
	}
}

/** Details of a certificate: its place on the host, its uses and its expiry alert */
function CertificateDialog({
	cert,
	onAlert,
	onClose,
}: {
	cert: CertificateRecord
	onAlert: () => void
	onClose: () => void
}) {
	const systems = useStore($allSystemsById)
	const alerts = useStore($certificateAlerts)
	const paths = useStore($certificatePaths)
	const links = useSensorLinks()(cert)
	const alert = certificateAlertOf(alerts, cert)
	const alertDays = alert?.days
	const error = cert.error
	const readOnly = isReadOnlyUser()
	const customPath = cert.custom
		? Object.values(paths).find((path) => path.system === cert.system && path.path === cert.path)
		: undefined

	async function removeCustom() {
		if (!customPath) {
			return
		}
		try {
			await pb.collection("certificate_paths").delete(customPath.id)
			await pb
				.send("/api/beszel/certificates/refresh", { method: "POST", query: { system: cert.system }, requestKey: null })
				.catch(() => undefined)
			onClose()
		} catch (e) {
			toast({ variant: "destructive", title: t`Error`, description: (e as Error).message })
		}
	}

	const issuer = commonName(cert.issuer)
	const subject = commonName(cert.subject)
	return (
		<DialogContent className="max-w-2xl w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto">
			<DialogHeader>
				<DialogTitle className="break-all">{cert.name}</DialogTitle>
				<DialogDescription>
					<Trans>Certificate read on the host by its agent.</Trans>
				</DialogDescription>
			</DialogHeader>
			{cert.error ? (
				<div className="grid gap-3 text-sm">
					<p className="rounded-lg border border-orange-500/40 bg-orange-500/10 px-4 py-3">
						<Trans>The agent could not read this certificate: {error}</Trans>
					</p>
					<dl className="grid sm:grid-cols-[10rem_minmax(0,1fr)] gap-x-4 gap-y-2">
						<HostRows cert={cert} systemName={systems[cert.system]?.name} links={links} />
					</dl>
				</div>
			) : (
				<CertDetails
					cert={{
						subject: subject,
						subjectDN: cert.subject,
						issuer: issuer,
						issuerDN: cert.issuer,
						names: cert.names ?? [],
						notBefore: cert.not_before,
						notAfter: cert.not_after,
						serial: cert.serial,
						sha256: cert.fingerprint,
						selfSigned: cert.self_signed,
					}}
				>
					<HostRows cert={cert} systemName={systems[cert.system]?.name} links={links} />
				</CertDetails>
			)}
			<DialogFooter className="gap-2">
				{customPath && !readOnly && (
					<Button variant="outline" className="gap-1.5 sm:me-auto" onClick={removeCustom}>
						<Trash2Icon className="size-4" />
						<Trans>Stop watching</Trans>
					</Button>
				)}
				{!readOnly && (
					<Button variant="outline" className="gap-1.5" onClick={onAlert}>
						{alert ? <BellRingIcon className="size-4" /> : <BellIcon className="size-4" />}
						{alert ? <Trans>Expiry alert: {alertDays} days</Trans> : <Trans>Expiry alert</Trans>}
					</Button>
				)}
			</DialogFooter>
		</DialogContent>
	)
}

/** Rows of the details of a certificate about its host: system, location, uses and sensors */
function HostRows({
	cert,
	systemName,
	links,
}: {
	cert: CertificateRecord
	systemName?: string
	links: ReturnType<ReturnType<typeof useSensorLinks>>
}) {
	return (
		<>
			<Row label={<Trans>System</Trans>}>
				<Link
					href={getPagePath($router, "system", { id: cert.system })}
					className="flex items-center gap-1.5 font-medium hover:underline"
				>
					<ServerIcon className="size-3.5 text-muted-foreground" />
					{systemName ?? cert.system}
				</Link>
			</Row>
			<Row label={<Trans>Location</Trans>}>
				<span className="font-mono text-xs break-all">{cert.path}</span>
				{cert.thumbprint && <Muted>{cert.thumbprint}</Muted>}
			</Row>
			{!!cert.uses?.length && (
				<Row label={<Trans>Used by</Trans>}>
					<ul className="grid gap-1">
						{cert.uses.map((use) => (
							<li key={`${use.kind}${use.location}${use.detail}`} className="grid">
								<span>
									<span className="font-medium">{certificateUseLabel(use)}</span>
									{use.detail && <span className="text-muted-foreground"> · {use.detail}</span>}
								</span>
								{use.location && <Muted>{use.location}</Muted>}
							</li>
						))}
					</ul>
				</Row>
			)}
			{links.length > 0 && (
				<Row label={<Trans>Seen by the sensors</Trans>}>
					<ul className="grid gap-1">
						{links.map(({ sensor, check }) => (
							<li key={check.id}>
								<Link href={getPagePath($router, "sensor", { id: sensor.id })} className="hover:underline">
									{sensor.name}
								</Link>
								<span className="text-muted-foreground"> · {checkName(check)}</span>
							</li>
						))}
					</ul>
				</Row>
			)}
		</>
	)
}

/** Sets or removes the expiry alert of the user on the certificates of the name of a certificate */
function CertificateAlertDialog({ cert, onClose }: { cert: CertificateRecord; onClose: () => void }) {
	const alerts = useStore($certificateAlerts)
	const systems = useStore($allSystemsById)
	const alert = certificateAlertOf(alerts, cert)
	const [days, setDays] = useState(String(alert?.days ?? defaultCertificateAlertDays))
	const [saving, setSaving] = useState(false)
	const name = cert.name
	const systemName = systems[cert.system]?.name ?? cert.system
	const valid = Number(days) >= 1 && Number(days) <= 365

	async function save(e: React.FormEvent) {
		e.preventDefault()
		setSaving(true)
		try {
			const collection = pb.collection("certificate_alerts")
			if (alert) {
				await collection.update(alert.id, { days: Number(days) })
			} else {
				await collection.create({ user: pb.authStore.record?.id, system: cert.system, name, days: Number(days) })
			}
			// checked right away by the next reading
			pb.send("/api/beszel/certificates/refresh", {
				method: "POST",
				query: { system: cert.system },
				requestKey: null,
			}).catch(() => undefined)
			onClose()
		} catch (err) {
			toast({ variant: "destructive", title: t`Error`, description: (err as Error).message })
		} finally {
			setSaving(false)
		}
	}

	return (
		<DialogContent className="max-w-md">
			<DialogHeader>
				<DialogTitle>
					<Trans>Expiry alert</Trans>
				</DialogTitle>
				<DialogDescription>
					<Trans>
						Alert when the certificate {name} of {systemName} expires in fewer days than the threshold. Renewed
						certificates of the same name stay checked, and the certificate becomes important.
					</Trans>
				</DialogDescription>
			</DialogHeader>
			<form onSubmit={save} className="grid gap-4">
				<div className="grid gap-2">
					<Label htmlFor="cert-alert-days">
						<Trans>Alert threshold (days before expiry)</Trans>
					</Label>
					<Input
						id="cert-alert-days"
						type="number"
						min={1}
						max={365}
						value={days}
						onChange={(e) => setDays(e.target.value)}
						required
					/>
				</div>
				<DialogFooter className="gap-2">
					{alert && (
						<Button
							type="button"
							variant="outline"
							className="gap-1.5 sm:me-auto"
							onClick={async () => {
								await removeAlert(alert)
								onClose()
							}}
						>
							<Trash2Icon className="size-4" />
							<Trans>Remove the alert</Trans>
						</Button>
					)}
					<Button type="submit" disabled={saving || !valid} className="gap-1.5">
						{saving && <LoaderCircleIcon className="size-4 animate-spin" />}
						<Trans>Save</Trans>
					</Button>
				</DialogFooter>
			</form>
		</DialogContent>
	)
}

/** Adds a certificate file of a host to the watched certificates */
function AddCertificateDialog({ onClose }: { onClose: () => void }) {
	const systems = useStore($allSystemsById)
	const [system, setSystem] = useState("")
	const [path, setPath] = useState("")
	const [saving, setSaving] = useState(false)
	const list = Object.values(systems).sort((a, b) => a.name.localeCompare(b.name))

	async function save(e: React.FormEvent) {
		e.preventDefault()
		setSaving(true)
		try {
			await pb.collection("certificate_paths").create({ system, path: path.trim() })
			try {
				await pb.send("/api/beszel/certificates/refresh", { method: "POST", query: { system }, requestKey: null })
			} catch (err) {
				if (/^outdated/i.test((err as Error).message)) {
					toast({
						title: t`Certificate added`,
						description: t`The agent of this system must be updated (0.20.0-fork.5 or newer) to read it.`,
					})
				}
			}
			onClose()
		} catch (err) {
			toast({ variant: "destructive", title: t`Error`, description: (err as Error).message })
		} finally {
			setSaving(false)
		}
	}

	return (
		<DialogContent className="max-w-lg">
			<DialogHeader>
				<DialogTitle>
					<Trans>Add a certificate</Trans>
				</DialogTitle>
				<DialogDescription>
					<Trans>
						Path of a certificate file on the host (PEM or DER), read by its agent with the other certificates. The
						agent must be allowed to read the file.
					</Trans>
				</DialogDescription>
			</DialogHeader>
			<form onSubmit={save} className="grid gap-4">
				<div className="grid gap-2">
					<Label htmlFor="cert-system">
						<Trans>System</Trans>
					</Label>
					<Select value={system} onValueChange={setSystem}>
						<SelectTrigger id="cert-system">
							<SelectValue placeholder={t`Select a system`} />
						</SelectTrigger>
						<SelectContent>
							{list.map((item) => (
								<SelectItem key={item.id} value={item.id}>
									{item.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="grid gap-2">
					<Label htmlFor="cert-path">
						<Trans>Path</Trans>
					</Label>
					<Input
						id="cert-path"
						value={path}
						onChange={(e) => setPath(e.target.value)}
						placeholder="/etc/ssl/certs/example.pem, C:\certs\example.cer"
						maxLength={1000}
						className="font-mono text-sm"
						required
					/>
				</div>
				<DialogFooter>
					<Button type="submit" disabled={saving || !system || !path.trim()} className="gap-1.5">
						{saving && <LoaderCircleIcon className="size-4 animate-spin" />}
						<Trans>Add</Trans>
					</Button>
				</DialogFooter>
			</form>
		</DialogContent>
	)
}

/** A path or a command of the recap, copied on its own */
function CodeField({ code }: { code: string }) {
	return (
		<div className="flex items-center gap-1 rounded-md border bg-muted/50 ps-3 pe-1 py-1 min-w-0">
			<code className="font-mono text-xs break-all grow">{code}</code>
			<Button
				variant="ghost"
				size="icon"
				className="size-7 shrink-0"
				aria-label={t`Copy`}
				title={t`Copy`}
				onClick={() => copyToClipboard(code)}
			>
				<CopyIcon className="size-3.5" />
			</Button>
		</div>
	)
}

/** A step of the recap: its sentence, with the file name in bold, and its code field */
function Step({ step }: { step: CertificateStep }) {
	const [before, after] = step.bold
		? [
				step.text.slice(0, step.text.indexOf(step.bold)),
				step.text.slice(step.text.indexOf(step.bold) + step.bold.length),
			]
		: [step.text, ""]
	return (
		<div className="grid gap-1">
			{step.text && (
				<span className="text-muted-foreground break-words">
					{before}
					{step.bold && <strong className="font-semibold text-foreground">{step.bold}</strong>}
					{after}
				</span>
			)}
			{step.code && <CodeField code={step.code} />}
		</div>
	)
}

/** Where to change each important certificate, for each service using it */
function RecapDialog({ certs }: { certs: CertificateRecord[] }) {
	const systems = useStore($allSystemsById)
	const now = useNow()
	const lines = certs.map((cert) => {
		const uses = cert.uses?.length ? cert.uses : [{ kind: "file", location: cert.path }]
		return {
			cert,
			systemName: systems[cert.system]?.name ?? cert.system,
			days: certificateDaysLeft(cert, now),
			uses: uses.map((use) => ({ use, steps: certificateUseSteps(use, cert) })),
		}
	})

	function copy() {
		const text = lines
			.map(({ cert, systemName, uses }) =>
				[
					`${cert.name} (${systemName}) - ${cert.not_after ? formatDateTime(cert.not_after) : ""}`,
					...uses.map(({ use, steps }) =>
						[
							`  - ${certificateUseLabel(use)}${use.detail ? ` (${use.detail})` : ""}`,
							...steps.map((step) =>
								[step.text && `    ${step.text}`, step.code && `      ${step.code}`].filter(Boolean).join("\n")
							),
						].join("\n")
					),
				].join("\n")
			)
			.join("\n\n")
		copyToClipboard(text)
	}

	return (
		<DialogContent className="max-w-3xl w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto">
			<DialogHeader>
				<DialogTitle>
					<Trans>Recap of the important certificates</Trans>
				</DialogTitle>
				<DialogDescription>
					<Trans>Where to change each important certificate, for each service using it.</Trans>
				</DialogDescription>
			</DialogHeader>
			<div className="grid gap-5">
				{lines.map(({ cert, systemName, days, uses }) => (
					<div key={cert.id} className="grid gap-2">
						<div className="flex flex-wrap items-center gap-2">
							<span className="font-semibold break-all">{cert.name}</span>
							<span className="text-sm text-muted-foreground">{systemName}</span>
							<DaysLeft days={days} />
						</div>
						<ul className="grid gap-3 border-s ps-4">
							{uses.map(({ use, steps }) => (
								<li key={`${use.kind}${use.location}${use.detail}`} className="grid gap-1.5 text-sm min-w-0">
									<span className="font-medium">
										{certificateUseLabel(use)}
										{use.detail && <span className="font-normal text-muted-foreground"> · {use.detail}</span>}
									</span>
									{steps.map((step) => (
										<Step key={`${step.text}${step.code}`} step={step} />
									))}
								</li>
							))}
						</ul>
					</div>
				))}
			</div>
			<DialogFooter>
				<Button variant="outline" className="gap-1.5" onClick={copy}>
					<CopyIcon className="size-4" />
					<Trans>Copy</Trans>
				</Button>
			</DialogFooter>
		</DialogContent>
	)
}
