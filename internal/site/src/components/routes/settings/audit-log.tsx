import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { redirectPage } from "@nanostores/router"
import {
	ChevronLeftIcon,
	ChevronRightIcon,
	GlobeIcon,
	LoaderCircleIcon,
	LogInIcon,
	MonitorSmartphoneIcon,
	PencilIcon,
	RefreshCwIcon,
	SaveIcon,
	ScrollTextIcon,
	ShieldAlertIcon,
	ShieldCheckIcon,
	TargetIcon,
	UserIcon,
	XIcon,
} from "lucide-react"
import type { RecordModel } from "pocketbase"
import { useCallback, useEffect, useState } from "react"
import { $router } from "@/components/router"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/use-toast"
import { isAdmin, pb } from "@/lib/api"
import { formatDateTime } from "@/lib/time"
import { cn } from "@/lib/utils"

interface AuditLogRecord extends RecordModel {
	user: string
	email: string
	action: string
	target_type: string
	target_id: string
	target_name: string
	ip: string
	user_agent: string
	details: Record<string, unknown> | null
	created: string
}

const perPage = 50

/** Kinds of entries of the filter, with their PocketBase filter */
const kinds = {
	all: { label: () => t`All`, filter: "" },
	logins: { label: () => t`Logins`, filter: "action ~ 'login'" },
	failed: { label: () => t`Failed logins`, filter: "action = 'login_failed'" },
	changes: { label: () => t`Changes`, filter: "action = 'create' || action = 'update' || action = 'delete'" },
	security: { label: () => t`Security`, filter: "action ~ 'mfa_' || action = 'agent_update'" },
} as const
type Kind = keyof typeof kinds

/** Name of an action */
function actionLabel(action: string) {
	const labels: Record<string, () => string> = {
		login: () => t`Login`,
		login_mfa: () => t`Password verified, second factor asked`,
		login_failed: () => t`Failed login`,
		create: () => t`Created`,
		update: () => t`Updated`,
		delete: () => t`Deleted`,
		mfa_enabled: () => t`Second factor enabled`,
		mfa_disabled: () => t`Second factor disabled`,
		mfa_recovery_used: () => t`Recovery code used`,
		agent_update: () => t`Agent update`,
	}
	return labels[action]?.() ?? action
}

/** Name of what an entry is about: a collection, or the login method */
function targetTypeLabel(type: string) {
	const labels: Record<string, () => string> = {
		password: () => t`Password`,
		otp: () => t`Code sent by email`,
		totp: () => t`Authenticator app`,
		ldap: () => t`Directory account`,
		oauth2: () => "OAuth2",
		systems: () => t`System`,
		users: () => t`User`,
		_superusers: () => t`Superuser`,
		alerts: () => t`Alert`,
		state_alerts: () => t`State rule`,
		quiet_hours: () => t`Quiet Hours`,
		sensors: () => t`Sensor`,
		sensor_checks: () => t`Sensor check`,
		sensor_alerts: () => t`Sensor alert`,
		network_monitors: () => t`Network monitor`,
		fingerprints: () => t`Fingerprint`,
		hub_settings: () => t`Hub settings`,
		certificate_paths: () => t`Certificate file`,
		certificate_alerts: () => t`Expiry alert`,
		ldap_config: () => t`Directory (LDAP)`,
		instance: () => t`Instance`,
	}
	return labels[type]?.() ?? type
}

function actionIcon(action: string) {
	if (action === "login_failed") {
		return <ShieldAlertIcon className="size-4 text-red-600 dark:text-red-400" />
	}
	if (action.startsWith("login")) {
		return <LogInIcon className="size-4 text-green-600 dark:text-green-400" />
	}
	if (action.startsWith("mfa_") || action === "agent_update") {
		return <ShieldCheckIcon className="size-4 text-primary" />
	}
	return <PencilIcon className="size-4 text-muted-foreground" />
}

/** Short text of the details of an entry: changed fields, method, result */
function detailsText(entry: AuditLogRecord) {
	const details = entry.details ?? {}
	if (Array.isArray(details.fields)) {
		return (details.fields as string[]).join(", ")
	}
	return Object.entries(details)
		.filter(([, value]) => value !== "" && value !== null && value !== undefined)
		.map(([key, value]) => `${key}: ${value}`)
		.join(" · ")
}

/** Logins and sensitive changes, for the admins */
export default function AuditLogSettings() {
	const [kind, setKind] = useState<Kind>("all")
	const [search, setSearch] = useState("")
	const [page, setPage] = useState(1)
	const [data, setData] = useState<{ items: AuditLogRecord[]; totalPages: number; totalItems: number }>()
	const [loading, setLoading] = useState(false)
	const [retention, setRetention] = useState<number>()
	const [savingRetention, setSavingRetention] = useState(false)

	const load = useCallback(async () => {
		setLoading(true)
		try {
			const filters: string[] = []
			if (kinds[kind].filter) {
				filters.push(`(${kinds[kind].filter})`)
			}
			const term = search.trim()
			if (term) {
				filters.push(
					pb.filter("(email ~ {:term} || target_name ~ {:term} || ip ~ {:term} || target_type ~ {:term})", { term })
				)
			}
			const result = await pb.collection<AuditLogRecord>("audit_logs").getList(page, perPage, {
				filter: filters.join(" && "),
				sort: "-created",
				requestKey: "audit-logs",
			})
			setData(result)
		} catch (err) {
			if (!(err as { isAbort?: boolean }).isAbort) {
				toast({ variant: "destructive", title: t`Error`, description: (err as Error).message })
			}
		} finally {
			setLoading(false)
		}
	}, [kind, search, page])

	useEffect(() => {
		if (!isAdmin()) {
			redirectPage($router, "settings", { name: "general" })
			return
		}
		const timer = setTimeout(load, search ? 300 : 0)
		return () => clearTimeout(timer)
	}, [load, search])

	useEffect(() => {
		pb.collection("hub_settings")
			.getOne("hubsettings0000", { fields: "audit_retention_days" })
			.then((settings) => setRetention(settings.audit_retention_days || 90))
			.catch(() => setRetention(90))
	}, [])

	async function saveRetention() {
		if (!retention || retention < 1) {
			return
		}
		setSavingRetention(true)
		try {
			await pb.collection("hub_settings").update("hubsettings0000", { audit_retention_days: retention })
			toast({ title: t`Settings saved` })
		} catch (err) {
			toast({ variant: "destructive", title: t`Error`, description: (err as Error).message })
		} finally {
			setSavingRetention(false)
		}
	}

	return (
		<div>
			<div>
				<h3 className="text-xl font-medium mb-2 flex items-center gap-2">
					<ScrollTextIcon className="size-5" />
					<Trans>Activity log</Trans>
				</h3>
				<p className="text-sm text-muted-foreground leading-relaxed">
					<Trans>
						Logins to Beszel, successful or failed, and the sensitive changes: who, when, from which address and on
						what.
					</Trans>
				</p>
			</div>
			<Separator className="my-4" />
			<div className="grid gap-4">
				<div className="flex flex-wrap gap-2 items-center">
					<Select
						value={kind}
						onValueChange={(value) => {
							setKind(value as Kind)
							setPage(1)
						}}
					>
						<SelectTrigger className="w-48">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{(Object.keys(kinds) as Kind[]).map((key) => (
								<SelectItem key={key} value={key}>
									{kinds[key].label()}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<div className="relative grow min-w-48">
						<Input
							value={search}
							onChange={(e) => {
								setSearch(e.target.value)
								setPage(1)
							}}
							placeholder={t`Search an email, an address, a name…`}
							className="pe-9"
						/>
						{search && (
							<Button
								variant="ghost"
								size="icon"
								className="absolute end-1 top-1/2 -translate-y-1/2 size-7"
								aria-label={t`Clear`}
								onClick={() => setSearch("")}
							>
								<XIcon className="size-4" />
							</Button>
						)}
					</div>
					<Button variant="outline" size="icon" onClick={load} disabled={loading} aria-label={t`Refresh`}>
						{loading ? <LoaderCircleIcon className="size-4 animate-spin" /> : <RefreshCwIcon className="size-4" />}
					</Button>
				</div>

				<div className="rounded-md border overflow-x-auto">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="whitespace-nowrap">
									<Trans>Date</Trans>
								</TableHead>
								<TableHead>
									<span className="flex items-center gap-2">
										<UserIcon className="size-4" />
										<Trans>User</Trans>
									</span>
								</TableHead>
								<TableHead>
									<Trans>Action</Trans>
								</TableHead>
								<TableHead>
									<span className="flex items-center gap-2">
										<TargetIcon className="size-4" />
										<Trans>Target</Trans>
									</span>
								</TableHead>
								<TableHead>
									<span className="flex items-center gap-2">
										<GlobeIcon className="size-4" />
										<Trans>Address</Trans>
									</span>
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{data?.items.map((entry) => {
								const details = detailsText(entry)
								return (
									<TableRow key={entry.id} className={cn(entry.action === "login_failed" && "bg-red-500/5")}>
										<TableCell className="whitespace-nowrap tabular-nums text-sm">
											{formatDateTime(entry.created)}
										</TableCell>
										<TableCell className="max-w-56 truncate" title={entry.email}>
											{entry.email || <span className="text-muted-foreground">-</span>}
										</TableCell>
										<TableCell>
											<span className="flex items-center gap-2 whitespace-nowrap">
												{actionIcon(entry.action)}
												{actionLabel(entry.action)}
											</span>
										</TableCell>
										<TableCell className="max-w-80">
											<div className="truncate" title={entry.target_name}>
												{targetTypeLabel(entry.target_type)}
												{entry.target_name && <span className="text-muted-foreground"> · {entry.target_name}</span>}
											</div>
											{details && (
												<div className="text-xs text-muted-foreground truncate" title={details}>
													{details}
												</div>
											)}
										</TableCell>
										<TableCell className="whitespace-nowrap text-sm">
											<span className="flex items-center gap-1.5" title={entry.user_agent}>
												<MonitorSmartphoneIcon className="size-3.5 text-muted-foreground" />
												{entry.ip}
											</span>
										</TableCell>
									</TableRow>
								)
							})}
							{data && !data.items.length && (
								<TableRow>
									<TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
										<Trans>No entries.</Trans>
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>
				</div>

				{data && data.totalPages > 1 && (
					<div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
						<span className="tabular-nums">
							{page} / {data.totalPages}
						</span>
						<Button
							variant="outline"
							size="icon"
							className="size-8"
							onClick={() => setPage(page - 1)}
							disabled={page <= 1}
							aria-label={t`Previous page`}
						>
							<ChevronLeftIcon className="size-4" />
						</Button>
						<Button
							variant="outline"
							size="icon"
							className="size-8"
							onClick={() => setPage(page + 1)}
							disabled={page >= data.totalPages}
							aria-label={t`Next page`}
						>
							<ChevronRightIcon className="size-4" />
						</Button>
					</div>
				)}

				<Separator />
				<div className="grid gap-2">
					<Label htmlFor="audit-retention">
						<Trans>Keep the log (days)</Trans>
					</Label>
					<div className="flex gap-2">
						<Input
							id="audit-retention"
							type="number"
							min={1}
							max={3650}
							className="w-32"
							value={retention ?? ""}
							onChange={(e) => setRetention(Number(e.target.value))}
						/>
						<Button
							variant="outline"
							className="gap-2"
							onClick={saveRetention}
							disabled={savingRetention || !retention}
						>
							{savingRetention ? <LoaderCircleIcon className="size-4 animate-spin" /> : <SaveIcon className="size-4" />}
							<Trans>Save</Trans>
						</Button>
					</div>
				</div>
			</div>
		</div>
	)
}
