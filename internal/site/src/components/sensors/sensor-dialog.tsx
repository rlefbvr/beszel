import { plural, t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { ChevronDownIcon, LoaderCircleIcon, PlusIcon, Settings2Icon, XIcon } from "lucide-react"
import { useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/components/ui/use-toast"
import {
	$checksBySensor,
	$sensorGroups,
	type CheckDraft,
	type PortPreset,
	addSensorChecks,
	checkColor,
	checkProtocol,
	pillClass,
	pillPalette,
	pillStyle,
	portPresets,
	presetOf,
	saveSensor,
} from "@/lib/sensors"
import { cn, secondsToString } from "@/lib/utils"
import type { SensorProtocol, SensorRecord } from "@/types"

/** Probe intervals offered, in seconds */
const intervals = [10, 20, 30, 60, 120, 300, 600]

function draftFromPreset(preset: Pick<PortPreset, "protocol" | "port" | "label">): CheckDraft {
	return {
		protocol: preset.protocol,
		port: preset.port,
		label: preset.label,
		url: "",
		keyword: "",
		accepted_codes: "",
		ignore_tls: false,
	}
}

/** Host of a pasted address: "https://nas.lan:5001/" gives "nas.lan" */
function hostOf(value: string) {
	const text = value.trim()
	if (!text.includes("://")) {
		return text
	}
	try {
		return new URL(text).hostname.replace(/^\[|\]$/g, "")
	} catch {
		return text
	}
}

export function intervalLabel(seconds: number) {
	return seconds < 60 ? plural(seconds, { one: "# second", other: "# seconds" }) : secondsToString(seconds, "minute")
}

/** Creates or edits a sensor: the host, its checks and their settings */
export function SensorDialog({ sensor, onDone }: { sensor?: SensorRecord; onDone: () => void }) {
	const groups = useStore($sensorGroups)
	const existingChecks = useStore($checksBySensor)[sensor?.id ?? ""] ?? []
	const [name, setName] = useState(sensor?.name ?? "")
	const [host, setHost] = useState(sensor?.host ?? "")
	const [description, setDescription] = useState(sensor?.description ?? "")
	const [group, setGroup] = useState(sensor?.group ?? "")
	const [interval, setInterval] = useState(sensor?.interval || 60)
	const [retries, setRetries] = useState(sensor?.retries ?? 1)
	const [latencyThreshold, setLatencyThreshold] = useState(sensor?.latency_threshold ?? 0)
	const [checks, setChecks] = useState<CheckDraft[]>(() =>
		sensor
			? existingChecks.map(({ id, protocol, port, label, url, keyword, accepted_codes, ignore_tls, color }) => ({
					id,
					protocol,
					port,
					label,
					url,
					keyword,
					accepted_codes,
					ignore_tls,
					color: color ?? "",
				}))
			: [draftFromPreset(portPresets[0])]
	)
	const [expanded, setExpanded] = useState<number | null>(null)
	const [saving, setSaving] = useState(false)

	const update = (index: number, change: Partial<CheckDraft>) =>
		setChecks((current) => current.map((check, i) => (i === index ? { ...check, ...change } : check)))

	const portInvalid = (check: CheckDraft) => check.protocol !== "icmp" && !(check.port >= 1 && check.port <= 65535)
	const valid = name.trim() && host.trim() && checks.length > 0 && !checks.some(portInvalid)

	const submit = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!valid) {
			return
		}
		setSaving(true)
		const data = {
			name: name.trim(),
			host: hostOf(host),
			description: description.trim(),
			group: group.trim(),
			interval,
			retries,
			latency_threshold: latencyThreshold,
		}
		const drafts = checks.map((check) => ({ ...check, label: check.label.trim() }))
		try {
			if (sensor) {
				await saveSensor({ id: sensor.id, ...data }, drafts, existingChecks)
			} else {
				// a host already checked gets the new checks in its sensor
				const result = await addSensorChecks(data, drafts)
				if (result.merged) {
					const sensorName = result.sensor.name
					const added = result.added
					toast({
						title: t`Checks added to ${sensorName}`,
						description: t`This host already has a sensor: ${added} new check(s) were added to it.`,
					})
				}
			}
			onDone()
		} catch (err) {
			toast({ variant: "destructive", title: t`Failed to save settings`, description: (err as Error).message })
		} finally {
			setSaving(false)
		}
	}

	return (
		<DialogContent className="max-w-3xl w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto">
			<DialogHeader>
				<DialogTitle>{sensor ? <Trans>Edit sensor</Trans> : <Trans>Add sensor</Trans>}</DialogTitle>
				<DialogDescription>
					<Trans>
						Beszel checks the ports of the host from the hub. The checks of the same host are grouped in one sensor.
					</Trans>
				</DialogDescription>
			</DialogHeader>
			<form onSubmit={submit} className="grid gap-5">
				<div className="grid sm:grid-cols-2 gap-4">
					<div className="grid gap-1.5">
						<Label htmlFor="sensor-name">
							<Trans>Name</Trans>
						</Label>
						<Input id="sensor-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor="sensor-host">
							<Trans>Host / IP</Trans>
						</Label>
						<Input
							id="sensor-host"
							value={host}
							onChange={(e) => setHost(e.target.value)}
							placeholder="192.168.1.10, nas.lan"
							maxLength={255}
							required
						/>
					</div>
					<div className="grid gap-1.5 sm:col-span-2">
						<Label htmlFor="sensor-description">
							<Trans>Information</Trans>
						</Label>
						<Input
							id="sensor-description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder={t`Location, owner, role…`}
							maxLength={200}
						/>
					</div>
					<div className="grid gap-1.5 sm:col-span-2">
						<Label htmlFor="sensor-group">
							<Trans>Group</Trans>
						</Label>
						<Input
							id="sensor-group"
							value={group}
							onChange={(e) => setGroup(e.target.value)}
							list="sensor-groups"
							maxLength={40}
						/>
						<datalist id="sensor-groups">
							{groups.map((name) => (
								<option key={name} value={name} />
							))}
						</datalist>
					</div>
					<div className="grid grid-cols-3 gap-3 sm:col-span-2">
						<div className="grid gap-1.5">
							<Label htmlFor="sensor-interval">
								<Trans>Interval</Trans>
							</Label>
							<Select value={String(interval)} onValueChange={(value) => setInterval(Number(value))}>
								<SelectTrigger id="sensor-interval">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{intervals.map((seconds) => (
										<SelectItem key={seconds} value={String(seconds)}>
											{intervalLabel(seconds)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="grid gap-1.5">
							<Label htmlFor="sensor-retries" title={t`Failed checks in a row tolerated before the sensor is down`}>
								<Trans>Retries</Trans>
							</Label>
							<Select value={String(retries)} onValueChange={(value) => setRetries(Number(value))}>
								<SelectTrigger id="sensor-retries">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{[0, 1, 2, 3, 5].map((count) => (
										<SelectItem key={count} value={String(count)}>
											{count}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="grid gap-1.5">
							<Label htmlFor="sensor-latency" title={t`Average response time above which the quality is degraded`}>
								<Trans>Latency (ms)</Trans>
							</Label>
							<Input
								id="sensor-latency"
								type="number"
								min={0}
								max={60000}
								value={latencyThreshold || ""}
								placeholder="-"
								onChange={(e) => setLatencyThreshold(Math.max(0, Number(e.target.value) || 0))}
							/>
						</div>
					</div>
				</div>

				<div className="grid gap-2">
					<div className="flex items-center justify-between gap-2">
						<Label>
							<Trans>Checks</Trans>
						</Label>
						<AddCheckMenu onAdd={(draft) => setChecks((current) => [...current, draft])} />
					</div>
					<div className="grid rounded-lg bg-muted/40 divide-y divide-border/50">
						{checks.map((check, index) => (
							<CheckRow
								key={check.id ?? `new-${index}`}
								check={check}
								host={hostOf(host)}
								expanded={expanded === index}
								onExpand={() => setExpanded(expanded === index ? null : index)}
								onChange={(change) => update(index, change)}
								onRemove={() => setChecks((current) => current.filter((_, i) => i !== index))}
								invalidPort={portInvalid(check)}
							/>
						))}
						{!checks.length && (
							<p className="text-sm text-muted-foreground px-3 py-2.5">
								<Trans>Add at least one check.</Trans>
							</p>
						)}
					</div>
				</div>

				<DialogFooter>
					<Button type="button" variant="outline" onClick={onDone}>
						<Trans>Cancel</Trans>
					</Button>
					<Button type="submit" className="gap-2" disabled={!valid || saving}>
						{saving && <LoaderCircleIcon className="size-4 animate-spin" />}
						{sensor ? <Trans>Save</Trans> : <Trans>Add sensor</Trans>}
					</Button>
				</DialogFooter>
			</form>
		</DialogContent>
	)
}

/** Menu of the known ports and services, and of another port with its own label */
function AddCheckMenu({ onAdd }: { onAdd: (draft: CheckDraft) => void }) {
	const [first, ...others] = portPresets
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button type="button" variant="outline" size="sm" className="gap-2">
					<PlusIcon className="size-4" />
					<Trans>Add a check</Trans>
					<ChevronDownIcon className="size-4 opacity-60" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="max-h-96 overflow-y-auto w-64">
				<DropdownMenuItem onSelect={() => onAdd(draftFromPreset(first))}>
					<PresetLabel preset={first} />
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => onAdd(draftFromPreset({ protocol: "tcp", port: 0, label: "" }))}>
					<span className="flex items-center gap-2">
						<Settings2Icon className="size-4 opacity-70" />
						<Trans>Other port…</Trans>
					</span>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuLabel className="text-xs text-muted-foreground">
					<Trans>Known ports</Trans>
				</DropdownMenuLabel>
				{others.map((preset) => (
					<DropdownMenuItem key={preset.key} onSelect={() => onAdd(draftFromPreset(preset))}>
						<PresetLabel preset={preset} />
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

function PresetLabel({ preset }: { preset: PortPreset }) {
	return (
		<span className="flex w-full items-center gap-2">
			<span
				style={pillStyle(preset.color)}
				className={cn("rounded-md px-1 text-[0.65rem] font-semibold leading-4 w-12 text-center", pillClass)}
			>
				{checkProtocol(preset)}
			</span>
			{preset.label}
			{preset.port > 0 && <span className="ms-auto text-xs text-muted-foreground tabular-nums">{preset.port}</span>}
		</span>
	)
}

/** Color of the pill of another port: a palette, or the default color */
function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="size-8 shrink-0"
					aria-label={t`Color`}
					title={t`Color`}
				>
					<span
						className={cn("size-4 rounded-full border", !value && "border-dashed border-muted-foreground")}
						style={value ? { backgroundColor: value, borderColor: value } : undefined}
					/>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="p-2">
				<div className="grid grid-cols-8 gap-1.5">
					{pillPalette.map((color) => (
						<DropdownMenuItem
							key={color}
							className={cn("size-6 p-0 rounded-full cursor-pointer", value === color && "ring-2 ring-offset-2 ring-offset-popover ring-foreground")}
							style={{ backgroundColor: color }}
							aria-label={color}
							onSelect={() => onChange(color)}
						/>
					))}
				</div>
				<DropdownMenuSeparator />
				<DropdownMenuItem className="text-xs" onSelect={() => onChange("")}>
					<Trans>Default color</Trans>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

/** Input without border until hovered or focused, for the rows of checks */
const bareInput = "h-8 border-transparent bg-transparent shadow-none hover:bg-background/60 focus-visible:bg-background"

/** One check of the dialog: its label and port, and the options of HTTP and DNS */
function CheckRow({
	check,
	host,
	expanded,
	onExpand,
	onChange,
	onRemove,
	invalidPort,
}: {
	check: CheckDraft
	host: string
	expanded: boolean
	onExpand: () => void
	onChange: (change: Partial<CheckDraft>) => void
	onRemove: () => void
	invalidPort: boolean
}) {
	const id = useId()
	const hasOptions = check.protocol === "http" || check.protocol === "dns"
	const scheme = check.port === 443 || check.port === 8443 ? "https" : "http"
	return (
		<div className="px-2 py-1.5 grid gap-2">
			<div className="flex items-center gap-1.5">
				<Select value={check.protocol} onValueChange={(protocol) => onChange({ protocol: protocol as SensorProtocol })}>
					<SelectTrigger
						style={pillStyle(checkColor(check))}
						className={cn(
							"h-7 w-24 shrink-0 border-0 shadow-none rounded-md px-2 text-xs font-semibold uppercase [&>svg]:opacity-60",
							pillClass
						)}
					>
						<SelectValue>{checkProtocol(check)}</SelectValue>
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="icmp">ICMP</SelectItem>
						<SelectItem value="tcp">TCP</SelectItem>
						<SelectItem value="http">HTTP</SelectItem>
						<SelectItem value="dns">DNS</SelectItem>
						<SelectItem value="ntp">NTP</SelectItem>
					</SelectContent>
				</Select>
				<Input
					aria-label={t`Label`}
					placeholder={t`Label`}
					value={check.label}
					onChange={(e) => onChange({ label: e.target.value })}
					maxLength={40}
					className={cn(bareInput, "flex-1 min-w-0")}
				/>
				{check.protocol !== "icmp" && (
					<Input
						aria-label={t`Port`}
						placeholder={t`Port`}
						type="number"
						min={1}
						max={65535}
						value={check.port || ""}
						onChange={(e) => onChange({ port: Number(e.target.value) || 0 })}
						className={cn(bareInput, "w-24 tabular-nums", invalidPort && "border-destructive")}
					/>
				)}
				{!presetOf(check) && <ColorPicker value={check.color ?? ""} onChange={(color) => onChange({ color })} />}
				{hasOptions && (
					<Button
						type="button"
						variant={expanded ? "secondary" : "ghost"}
						size="icon"
						className="size-8 shrink-0"
						aria-label={t`Options`}
						title={t`Options`}
						onClick={onExpand}
					>
						<Settings2Icon className="size-4" />
					</Button>
				)}
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="size-8 shrink-0"
					aria-label={t`Remove`}
					onClick={onRemove}
				>
					<XIcon className="size-4" />
				</Button>
			</div>
			{expanded && check.protocol === "http" && (
				<div className="grid sm:grid-cols-2 gap-2.5 px-1 pb-1.5">
					<div className="grid gap-1 sm:col-span-2">
						<Label className="text-xs">
							<Trans>Address</Trans>
						</Label>
						<Input
							value={check.url}
							onChange={(e) => onChange({ url: e.target.value })}
							placeholder={`${scheme}://${host || "host"}${check.port && check.port !== 80 && check.port !== 443 ? `:${check.port}` : ""}/`}
							maxLength={500}
							className="h-8"
						/>
					</div>
					<div className="grid gap-1">
						<Label className="text-xs">
							<Trans>Expected text</Trans>
						</Label>
						<Input
							value={check.keyword}
							onChange={(e) => onChange({ keyword: e.target.value })}
							maxLength={200}
							className="h-8"
						/>
					</div>
					<div className="grid gap-1">
						<Label className="text-xs">
							<Trans>Accepted status codes</Trans>
						</Label>
						<Input
							value={check.accepted_codes}
							onChange={(e) => onChange({ accepted_codes: e.target.value })}
							placeholder="200-299"
							maxLength={100}
							className="h-8"
						/>
					</div>
					<div className="flex items-center gap-2 text-sm sm:col-span-2">
						<Checkbox
							id={`${id}-tls`}
							checked={check.ignore_tls}
							onCheckedChange={(value) => onChange({ ignore_tls: value === true })}
						/>
						<label htmlFor={`${id}-tls`} className="cursor-pointer">
							<Trans>Ignore TLS certificate errors</Trans>
						</label>
					</div>
				</div>
			)}
			{expanded && check.protocol === "dns" && (
				<div className="grid gap-1 px-1 pb-1.5">
					<Label className="text-xs">
						<Trans>Name to resolve</Trans>
					</Label>
					<Input
						value={check.url}
						onChange={(e) => onChange({ url: e.target.value })}
						placeholder="example.com"
						maxLength={255}
						className="h-8"
					/>
				</div>
			)}
		</div>
	)
}
