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
	ExternalLinkIcon,
	FilterIcon,
	FolderIcon,
	GlobeIcon,
	LoaderCircleIcon,
	ServerIcon,
	Settings2Icon,
	TableIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react"
import { useMemo, useState } from "react"
import { type ImportantTile, ImportantTargets } from "@/components/important-targets"
import { $router, Link } from "@/components/router"
import { sameHost } from "@/components/sensors/host-links"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/use-toast"
import { SortableHead, type TableSort } from "@/components/sortable-head"
import { cellWidthStyle, resizedAttr, useTableLayout } from "@/components/table-layout"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { isReadOnlyUser, pb, queueUserSettings } from "@/lib/api"
import {
	$certificateAlerts,
	$certificates,
	certificateAlertOf,
	certificateDaysLeft,
	certificateUseLabel,
	defaultCertificateAlertDays,
	normalizeFingerprint,
} from "@/lib/certificates"
import { $sensorAlerts } from "@/lib/sensor-alerts"
import { $checksBySensor, $sensors, checkName } from "@/lib/sensors"
import { $allSystemsById, $userSettings } from "@/lib/stores"
import { formatDateTime, useNow } from "@/lib/time"
import { cn } from "@/lib/utils"
import type {
	CertificateRecord,
	SensorAlertRecord,
	SensorCheckRecord,
	SensorRecord,
	SystemRecord,
	UserSettings,
} from "@/types"
import { commonName, DaysLeft, expiringDays } from "./certificate-parts"

/** A certificate served over HTTPS to a check of a sensor of a host */
export interface WebCertificate {
	key: string
	sensor: SensorRecord
	check: SensorCheckRecord
	system: SystemRecord
	/** the certificate of the host serving it, read by its agent */
	local?: CertificateRecord
}

/** Address checked by an HTTPS check: its URL, else the host and port of the sensor */
function checkAddress(sensor: SensorRecord, check: SensorCheckRecord) {
	return check.url || `https://${sensor.host}${check.port && check.port !== 443 ? `:${check.port}` : ""}`
}

/** The certificates served over HTTPS to the checks of the sensors sharing the address of a system, soonest expiry first */
export function useWebCertificates() {
	const sensors = useStore($sensors)
	const checksBySensor = useStore($checksBySensor)
	const systems = useStore($allSystemsById)
	const certificates = useStore($certificates)
	const now = useNow()
	return useMemo(() => {
		const list: WebCertificate[] = []
		for (const sensor of Object.values(sensors)) {
			// several systems may share the address: the one holding the certificate, else the first
			const hostSystems = Object.values(systems).filter((item) => sameHost(item.host, sensor.host))
			if (!hostSystems.length) {
				continue
			}
			for (const check of checksBySensor[sensor.id] ?? []) {
				if (check.protocol !== "http" || !check.cert?.sha256) {
					continue
				}
				const fingerprint = normalizeFingerprint(check.cert.sha256)
				const local = Object.values(certificates).find(
					(cert) =>
						hostSystems.some((item) => item.id === cert.system) &&
						normalizeFingerprint(cert.fingerprint) === fingerprint
				)
				const system = hostSystems.find((item) => item.id === local?.system) ?? hostSystems[0]
				list.push({ key: check.id, sensor, check, system, local })
			}
		}
		const days = (row: WebCertificate) =>
			certificateDaysLeft({ not_after: row.check.cert?.notAfter ?? "" }, now) ?? Number.MAX_SAFE_INTEGER
		return list.sort((a, b) => days(a) - days(b) || a.system.name.localeCompare(b.system.name))
	}, [sensors, checksBySensor, systems, certificates, now])
}

/** Columns the web certificates are sorted on */
type WebSort = "address" | "system" | "expiry" | "issuer" | "host"

/** Columns of the web certificates the user can hide */
const webColumns = {
	system: () => t`System`,
	expiry: () => t`Expires`,
	issuer: () => t`Issued by`,
	host: () => t`On the host`,
}
type WebColumn = keyof typeof webColumns

/** Status of a served certificate, as the status filter of the view shows it */
type WebStatus = "all" | "valid" | "expiring" | "expired"

function webStatus(days: number | null): Exclude<WebStatus, "all"> {
	return days === null || days > expiringDays ? "valid" : days < 0 ? "expired" : "expiring"
}

/** Saves a display setting of the web certificates for the user */
function saveSetting<K extends "webCertificatesStatus" | "webCertificatesHidden">(key: K, value: UserSettings[K]) {
	$userSettings.setKey(key, value)
	queueUserSettings({ [key]: value })
}

/** The certificate alert of a sensor: its HTTPS checks expiring within its days */
export function sensorCertAlertOf(alerts: Record<string, SensorAlertRecord>, sensorId: string) {
	return Object.values(alerts).find((alert) => alert.sensor === sensorId && alert.name === "cert")
}

/**
 * The certificates the hosts serve over HTTPS, as the HTTPS checks of their
 * sensors see them, with the certificate of the host serving each one: where
 * it is and what renews it (Traefik and Let's Encrypt). Their bell is the
 * expiry alert of that certificate of the host, like in its details; for a
 * certificate not found on the host, the certificate alert of the sensor.
 */
export function WebCertificates({
	rows,
	onOpen,
	onAlert,
	recapCount,
	onRecap,
}: {
	rows: WebCertificate[]
	/** opens the details of the certificate of the host */
	onOpen: (cert: CertificateRecord) => void
	/** opens the expiry alert of the certificate of the host, the same as in its details */
	onAlert: (cert: CertificateRecord) => void
	/** certificates of the hosts in the recap: served ones with the alert of their sensor */
	recapCount: number
	onRecap: () => void
}) {
	const [filter, setFilter] = useState("")
	const settings = useStore($userSettings)
	const status = settings.webCertificatesStatus ?? "all"
	const hidden = settings.webCertificatesHidden ?? []
	const show = (column: WebColumn) => !hidden.includes(column)
	const alerts = useStore($sensorAlerts)
	const certificateAlerts = useStore($certificateAlerts)
	const now = useNow()
	const readOnly = isReadOnlyUser()
	const [alerting, setAlerting] = useState<SensorRecord | null>(null)
	const [sort, setSort] = useState<TableSort<WebSort>>({ key: "expiry", desc: false })
	// widths of the columns resized by the user
	const layout = useTableLayout("web-certificates")
	const col = (id: WebSort) => ({ style: cellWidthStyle(layout.widths[id]), ...resizedAttr(layout.widths[id]) })
	const sorted = useMemo(() => {
		const days = (row: WebCertificate) =>
			certificateDaysLeft({ not_after: row.check.cert?.notAfter ?? "" }, now) ?? Number.MAX_SAFE_INTEGER
		const text = (row: WebCertificate) => {
			switch (sort.key) {
				case "address":
					return checkAddress(row.sensor, row.check)
				case "system":
					return row.system.name
				case "issuer":
					return commonName(row.check.cert?.issuer ?? "")
				case "host":
					return row.local?.path ?? "~"
			}
			return ""
		}
		const compare = (a: WebCertificate, b: WebCertificate) =>
			sort.key === "expiry" ? days(a) - days(b) : text(a).localeCompare(text(b)) || days(a) - days(b)
		const terms = filter.toLowerCase().split(" ").filter(Boolean)
		return rows
			.filter((row) => {
				if (
					status !== "all" &&
					webStatus(certificateDaysLeft({ not_after: row.check.cert?.notAfter ?? "" }, now)) !== status
				) {
					return false
				}
				const words =
					`${checkAddress(row.sensor, row.check)} ${row.sensor.name} ${row.system.name} ${row.check.cert?.issuer ?? ""} ${row.check.cert?.subject ?? ""} ${row.local?.path ?? ""} ${(row.local?.uses ?? []).map(certificateUseLabel).join(" ")}`.toLowerCase()
				return terms.every((term) => words.includes(term))
			})
			.sort((a, b) => (sort.desc ? compare(b, a) : compare(a, b)))
	}, [rows, sort, now, filter, status])

	// the web certificates with an expiry alert, first, like the local ones
	const tiles = rows.flatMap(({ key, sensor, check, system, local }): ImportantTile[] => {
		const localAlert = local && certificateAlertOf(certificateAlerts, local)
		const sensorAlert = !local && sensorCertAlertOf(alerts, sensor.id)
		const alert = localAlert || sensorAlert
		if (!alert) {
			return []
		}
		const threshold = localAlert ? localAlert.days : sensorAlert ? sensorAlert.value : 0
		const days = certificateDaysLeft({ not_after: check.cert?.notAfter ?? "" }, now)
		return [
			{
				key,
				name: checkAddress(sensor, check).replace(/^https:\/\//, ""),
				systemName: system.name,
				dotClass:
					days === null
						? "bg-muted-foreground"
						: days < 0
							? "bg-red-500"
							: days <= threshold
								? "bg-orange-500"
								: "bg-green-500",
				status:
					days === null ? (
						"-"
					) : days < 0 ? (
						<Trans>Expired</Trans>
					) : (
						<Plural value={days} one="Expires in # day" other="Expires in # days" />
					),
				triggered: alert.triggered,
				onClick: local ? () => onOpen(local) : undefined,
				onRemove: () =>
					pb
						.collection(localAlert ? "certificate_alerts" : "sensor_alerts")
						.delete(alert.id)
						.then(() => undefined),
				removeDescription: <Trans>Its expiry alert is deleted: no notification is sent before it expires.</Trans>,
			},
		]
	})

	return (
		<Card className="@container w-full px-3 py-5 sm:py-6 sm:px-6">
			<CardHeader className="p-0 mb-3 sm:mb-4">
				<div className="grid md:flex gap-x-5 gap-y-3 w-full items-end">
					<div className="px-2 sm:px-1">
						<CardTitle className="mb-2">
							<Trans>Web certificates</Trans>
						</CardTitle>
						<CardDescription>
							<Trans>
								Certificates served over HTTPS by the hosts, seen by the HTTPS checks of their sensors, with the
								certificate of the host serving them.
							</Trans>
						</CardDescription>
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
						<WebViewMenu sort={sort} onSort={setSort} status={status} hidden={hidden} />
						{/* a disabled button gets no hover: its wrapper tells why it is disabled */}
						<span
							className="inline-flex"
							title={
								recapCount
									? undefined
									: t`Set an expiry alert (bell) on a web certificate found on its host to get its recap.`
							}
						>
							<Button variant="outline" className="gap-1.5" onClick={onRecap} disabled={!recapCount}>
								<ClipboardListIcon className="size-4" />
								<Trans>Recap</Trans>
							</Button>
						</span>
					</div>
				</div>
			</CardHeader>
			<ImportantTargets
				title={<Trans>Important web certificates</Trans>}
				subtitle={<Trans>With an expiry alert</Trans>}
				tiles={tiles}
			/>
			<div className="rounded-md border overflow-x-auto">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-12" />
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
							{show("system") && (
								<SortableHead
									sortKey="system"
									sort={sort}
									onSort={setSort}
									width={layout.widths.system}
									onResize={layout.onColumnResize}
									Icon={ServerIcon}
								>
									<Trans>System</Trans>
								</SortableHead>
							)}
							{show("expiry") && (
								<SortableHead
									sortKey="expiry"
									sort={sort}
									onSort={setSort}
									width={layout.widths.expiry}
									onResize={layout.onColumnResize}
									Icon={CalendarClockIcon}
								>
									<Trans>Expires</Trans>
								</SortableHead>
							)}
							{show("issuer") && (
								<SortableHead
									sortKey="issuer"
									sort={sort}
									onSort={setSort}
									width={layout.widths.issuer}
									onResize={layout.onColumnResize}
									Icon={BadgeCheckIcon}
								>
									<Trans>Issued by</Trans>
								</SortableHead>
							)}
							{show("host") && (
								<SortableHead
									sortKey="host"
									sort={sort}
									onSort={setSort}
									width={layout.widths.host}
									onResize={layout.onColumnResize}
									Icon={FolderIcon}
								>
									<Trans>On the host</Trans>
								</SortableHead>
							)}
						</TableRow>
					</TableHeader>
					<TableBody>
						{sorted.map(({ key, sensor, check, system, local }) => {
							const cert = check.cert
							const days = certificateDaysLeft({ not_after: cert?.notAfter ?? "" }, now)
							// the alert of the certificate of the host when found there, else the certificate alert of the sensor
							const localAlert = local && certificateAlertOf(certificateAlerts, local)
							const sensorAlert = !local && sensorCertAlertOf(alerts, sensor.id)
							const alert = localAlert || sensorAlert
							const alertDays = localAlert ? localAlert.days : sensorAlert ? sensorAlert.value : 0
							const address = checkAddress(sensor, check)
							const uses = [...new Set((local?.uses ?? []).map(certificateUseLabel))]
							return (
								<TableRow key={key} className={cn(local && "cursor-pointer")} onClick={() => local && onOpen(local)}>
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
												if (local) {
													onAlert(local)
												} else {
													setAlerting(sensor)
												}
											}}
										>
											{alert ? <BellRingIcon className="size-4" /> : <BellIcon className="size-4" />}
										</Button>
									</TableCell>
									<TableCell className="py-2 max-w-80" {...col("address")}>
										<a
											href={address}
											target="_blank"
											rel="noreferrer"
											className="flex items-center gap-1.5 font-medium hover:underline min-w-0"
											onClick={(e) => e.stopPropagation()}
										>
											<span className="truncate">{address.replace(/^https:\/\//, "")}</span>
											<ExternalLinkIcon className="size-3.5 shrink-0 opacity-60" />
										</a>
										<Link
											href={getPagePath($router, "sensor", { id: sensor.id })}
											className="block truncate text-xs text-muted-foreground hover:underline"
											onClick={(e) => e.stopPropagation()}
										>
											{sensor.name} · {checkName(check)}
										</Link>
									</TableCell>
									{show("system") && (
										<TableCell className="py-2 whitespace-nowrap" {...col("system")}>
											{system.name}
										</TableCell>
									)}
									{show("expiry") && (
										<TableCell className="py-2 whitespace-nowrap" {...col("expiry")}>
											<span className="flex items-center gap-2">
												<DaysLeft days={days} />
												<span className="text-xs text-muted-foreground tabular-nums">
													{cert?.notAfter && formatDateTime(cert.notAfter).split(" ")[0]}
												</span>
											</span>
										</TableCell>
									)}
									{show("issuer") && (
										<TableCell
											className="py-2 max-w-48 truncate text-sm"
											title={cert?.issuerDN || cert?.issuer}
											{...col("issuer")}
										>
											{commonName(cert?.issuer ?? "")}
										</TableCell>
									)}
									{show("host") && (
										<TableCell className="py-2 max-w-80" {...col("host")}>
											{local ? (
												<>
													<div className="flex flex-wrap gap-1">
														{uses.map((label) => (
															<span key={label} className="rounded bg-muted px-1.5 py-0.5 text-xs whitespace-nowrap">
																{label}
															</span>
														))}
													</div>
													<div className="truncate font-mono text-xs text-muted-foreground mt-0.5" title={local.path}>
														{local.path}
													</div>
												</>
											) : (
												<span className="text-xs text-muted-foreground">
													<Trans>Not found among the certificates read on the host</Trans>
												</span>
											)}
										</TableCell>
									)}
								</TableRow>
							)
						})}
						{!sorted.length && (
							<TableRow>
								<TableCell colSpan={6 - hidden.length} className="h-20 text-center text-muted-foreground">
									{rows.length ? (
										<Trans>No certificates match the filter.</Trans>
									) : (
										<Trans>No HTTPS check on a sensor sharing the address of a system.</Trans>
									)}
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>
			<Dialog open={!!alerting} onOpenChange={(open) => !open && setAlerting(null)}>
				{alerting && <WebCertAlertDialog sensor={alerting} onClose={() => setAlerting(null)} />}
			</Dialog>
		</Card>
	)
}

/** View of the web certificates: their order, status filter and shown columns */
function WebViewMenu({
	sort,
	onSort,
	status,
	hidden,
}: {
	sort: TableSort<WebSort>
	onSort: (sort: TableSort<WebSort>) => void
	status: WebStatus
	hidden: string[]
}) {
	const { expiry, ...otherColumns } = webColumns
	const sorts: Record<WebSort, () => string> = { expiry, address: () => t`Address`, ...otherColumns }
	const statuses: Record<WebStatus, () => string> = {
		all: () => t`All`,
		valid: () => t`Valid`,
		expiring: () => t`Expiring soon`,
		expired: () => t`Expired`,
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
						<DropdownMenuRadioGroup
							className="px-1 pb-1"
							value={sort.key}
							onValueChange={(value) => onSort({ key: value as WebSort, desc: false })}
						>
							{(Object.keys(sorts) as WebSort[]).map((value) => (
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
							onValueChange={(value) => saveSetting("webCertificatesStatus", value as WebStatus)}
						>
							{(Object.keys(statuses) as WebStatus[]).map((value) => (
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
							{(Object.keys(webColumns) as WebColumn[]).map((column) => (
								<DropdownMenuCheckboxItem
									key={column}
									onSelect={(e) => e.preventDefault()}
									checked={!hidden.includes(column)}
									onCheckedChange={(visible) =>
										saveSetting(
											"webCertificatesHidden",
											visible ? hidden.filter((c) => c !== column) : [...hidden.filter((c) => c !== column), column]
										)
									}
								>
									{webColumns[column]()}
								</DropdownMenuCheckboxItem>
							))}
						</div>
					</div>
				</div>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

/** The certificate alert of a sensor: its HTTPS checks, served certificates expiring within a number of days */
function WebCertAlertDialog({ sensor, onClose }: { sensor: SensorRecord; onClose: () => void }) {
	const alert = sensorCertAlertOf(useStore($sensorAlerts), sensor.id)
	const [days, setDays] = useState(String(alert?.value ?? defaultCertificateAlertDays))
	const [saving, setSaving] = useState(false)
	const sensorName = sensor.name
	const valid = Number(days) >= 1 && Number(days) <= 365

	async function run(action: () => Promise<unknown>) {
		setSaving(true)
		try {
			await action()
			onClose()
		} catch (err) {
			toast({ variant: "destructive", title: t`Error`, description: (err as Error).message })
		} finally {
			setSaving(false)
		}
	}

	const collection = pb.collection("sensor_alerts")
	const save = (e: React.FormEvent) => {
		e.preventDefault()
		run(() =>
			alert
				? collection.update(alert.id, { value: Number(days) })
				: collection.create({
						user: pb.authStore.record?.id,
						sensor: sensor.id,
						name: "cert",
						value: Number(days),
						min: 0,
						checks: [],
					})
		)
	}

	return (
		<DialogContent className="max-w-md">
			<DialogHeader>
				<DialogTitle>
					<Trans>Expiry alert</Trans>
				</DialogTitle>
				<DialogDescription>
					<Trans>
						Alert when a certificate served over HTTPS to the checks of {sensorName} expires in fewer days than the
						threshold. It is the certificate alert of the sensor.
					</Trans>
				</DialogDescription>
			</DialogHeader>
			<form onSubmit={save} className="grid gap-4">
				<div className="grid gap-2">
					<Label htmlFor="web-cert-alert-days">
						<Trans>Alert threshold (days before expiry)</Trans>
					</Label>
					<Input
						id="web-cert-alert-days"
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
							disabled={saving}
							onClick={() => run(() => collection.delete(alert.id))}
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
