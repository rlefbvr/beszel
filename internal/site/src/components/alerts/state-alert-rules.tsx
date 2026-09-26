import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { ActivityIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/components/ui/use-toast"
import { isReadOnlyUser, pb } from "@/lib/api"
import { $stateAlerts, systemStateAlerts } from "@/lib/state-alerts"
import { ContainerHealthLabels, ServiceStatusLabels, ServiceSubStateLabels } from "@/lib/enums"
import { cn } from "@/lib/utils"
import type { StateAlertRecord, SystemRecord } from "@/types"

type Kind = StateAlertRecord["kind"]
export type RuleDraft = Pick<
	StateAlertRecord,
	"kind" | "targets" | "condition" | "states" | "sub_states" | "cycles" | "metric" | "threshold"
>

const collection = "state_alerts"

/** Selectable states per rule kind; values match the hub's lowercase keys */
export const stateOptions: Record<Kind, { states: readonly string[]; subStates: readonly string[] }> = {
	service: { states: ServiceStatusLabels, subStates: ServiceSubStateLabels },
	container: { states: ["Running", "Paused", "Restarting", "Stopped"], subStates: ContainerHealthLabels },
	process: { states: ["Running", "Stopped"], subStates: [] },
}

export const newDraft = (kind: Kind = "service"): RuleDraft => ({
	kind,
	targets: "",
	condition: "is_not",
	states: kind === "service" ? ["active"] : ["running"],
	sub_states: [],
	cycles: kind === "process" ? 2 : 1,
	metric: "",
	threshold: 0,
})

const kindLabel = (kind: Kind) =>
	kind === "service" ? t`Services` : kind === "process" ? t`Processes` : t`Containers`

/** What a process rule watches, as one choice */
type ProcessMode = "absent" | "present" | "cpu" | "mem" | "count_above" | "count_below"

function processMode(rule: RuleDraft): ProcessMode {
	switch (rule.metric) {
		case "cpu":
			return "cpu"
		case "mem":
			return "mem"
		case "count":
			return rule.condition === "below" ? "count_below" : "count_above"
	}
	return rule.condition === "is" ? "present" : "absent"
}

function withProcessMode(rule: RuleDraft, mode: ProcessMode): RuleDraft {
	const base = { ...rule, states: [] as string[], sub_states: [] as string[] }
	switch (mode) {
		case "absent":
			return { ...base, condition: "is_not", states: ["running"], metric: "", threshold: 0 }
		case "present":
			return { ...base, condition: "is", states: ["running"], metric: "", threshold: 0 }
		case "cpu":
		case "mem":
			return { ...base, condition: "above", metric: mode, threshold: rule.metric === mode ? rule.threshold : 80 }
		case "count_above":
			return { ...base, condition: "above", metric: "count", threshold: rule.metric === "count" ? rule.threshold : 10 }
		case "count_below":
			return { ...base, condition: "below", metric: "count", threshold: rule.metric === "count" ? rule.threshold : 1 }
	}
}

function processModeLabel(mode: ProcessMode) {
	switch (mode) {
		case "absent":
			return t`Alert when the process is not running`
		case "present":
			return t`Alert when the process is running`
		case "cpu":
			return t`Alert when its CPU is above`
		case "mem":
			return t`Alert when its memory is above`
		case "count_above":
			return t`Alert when its instances are more than`
		case "count_below":
			return t`Alert when its instances are fewer than`
	}
}

/** Whether a draft can be saved: targets, and states or a threshold */
export function ruleIsComplete(rule: RuleDraft) {
	if (!rule.targets.trim()) {
		return false
	}
	if (rule.metric) {
		const threshold = rule.threshold ?? -1
		return rule.metric === "count" ? threshold >= (rule.condition === "below" ? 1 : 0) : threshold >= 0 && threshold <= 100
	}
	return rule.states.length > 0 || rule.sub_states.length > 0
}

/**
 * Condition of a process rule: running or not, or a threshold on its CPU,
 * memory or instances (all the instances of the program count together).
 */
export function ProcessRuleFields({ draft, onChange }: { draft: RuleDraft; onChange: (draft: RuleDraft) => void }) {
	const mode = processMode(draft)
	const percent = draft.metric === "cpu" || draft.metric === "mem"
	return (
		<div className="grid sm:grid-cols-[minmax(0,1fr)_9rem] gap-3 items-end">
			<div className="grid gap-1.5">
				<Label htmlFor="sa-process-mode">
					<Trans>Condition</Trans>
				</Label>
				<Select value={mode} onValueChange={(value: ProcessMode) => onChange(withProcessMode(draft, value))}>
					<SelectTrigger id="sa-process-mode">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{(["absent", "present", "cpu", "mem", "count_above", "count_below"] as const).map((value) => (
							<SelectItem key={value} value={value}>
								{processModeLabel(value)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			{draft.metric && (
				<div className="grid gap-1.5">
					<Label htmlFor="sa-threshold">{percent ? t`Threshold (%)` : t`Instances`}</Label>
					<Input
						id="sa-threshold"
						type="number"
						min={draft.metric === "count" && draft.condition === "below" ? 1 : 0}
						max={percent ? 100 : 100000}
						step={percent ? 0.5 : 1}
						value={draft.threshold ?? 0}
						onChange={(e) => {
							const threshold = Number.parseFloat(e.target.value)
							if (!Number.isNaN(threshold)) onChange({ ...draft, threshold })
						}}
					/>
				</div>
			)}
			<span className="text-xs text-muted-foreground sm:col-span-2">
				{percent ? (
					<Trans>Percent of the whole host, all the instances of the program added up.</Trans>
				) : (
					<Trans>All the instances of a program count as one target, such as every chrome.exe.</Trans>
				)}
			</span>
		</div>
	)
}

/** The condition of a rule, such as "must be running" or "state is not active" */
export function describeRule(rule: RuleDraft) {
	if (rule.kind === "process") {
		const threshold = rule.threshold ?? 0
		switch (processMode(rule)) {
			case "absent":
				return t`must be running`
			case "present":
				return t`must not be running`
			case "cpu":
				return t`CPU above ${threshold}%`
			case "mem":
				return t`memory above ${threshold}%`
			case "count_above":
				return t`more than ${threshold} instances`
			case "count_below":
				return t`fewer than ${threshold} instances`
		}
	}
	const states = rule.states.join(" / ")
	const subStates = rule.sub_states.length ? ` (${rule.sub_states.join(" / ")})` : ""
	const condition = rule.condition === "is" ? t`state is` : t`state is not`
	return `${condition} ${states}${subStates}`.trim()
}

/** Per-system rules alerting on service or Docker container states */
export function StateAlertRules({ system }: { system: SystemRecord }) {
	// kept in sync by the shared store, including triggered flags set by the hub
	const allRules = useStore($stateAlerts)
	const rules = useMemo(() => systemStateAlerts(allRules, system.id), [allRules, system.id])
	const [editing, setEditing] = useState<StateAlertRecord | "new" | null>(null)
	const readOnly = isReadOnlyUser()

	function setRule(rule: StateAlertRecord) {
		$stateAlerts.setKey(rule.id, rule)
	}

	async function deleteRule(rule: StateAlertRecord) {
		try {
			await pb.collection(collection).delete(rule.id)
			const { [rule.id]: _, ...rest } = $stateAlerts.get()
			$stateAlerts.set(rest)
		} catch (e) {
			failedToast(e)
		}
	}

	return (
		<div className="rounded-lg border border-muted-foreground/15 p-4 grid gap-3">
			<div className="flex items-start justify-between gap-4">
				<div className="grid gap-1">
					<p className="font-semibold flex gap-3 items-center">
						<ActivityIcon className="h-4 w-4 opacity-85" />
						<Trans>State rules</Trans>
					</p>
					<span className="text-sm text-muted-foreground">
						<Trans>Alert when services, Docker containers or processes enter or leave a state.</Trans>
					</span>
				</div>
				{!readOnly && editing === null && (
					<Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={() => setEditing("new")}>
						<PlusIcon className="h-3.5 w-3.5" />
						<Trans>Add rule</Trans>
					</Button>
				)}
			</div>

			{rules.map((rule) =>
				editing !== "new" && editing?.id === rule.id ? (
					<RuleForm
						key={rule.id}
						system={system}
						rule={rule}
						onDone={(saved) => {
							if (saved) setRule(saved)
							setEditing(null)
						}}
					/>
				) : (
					<div key={rule.id} className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2 text-sm">
						<div className="grid gap-0.5 min-w-0">
							<div className="flex items-center gap-2 min-w-0">
								<span className="font-medium shrink-0">{kindLabel(rule.kind)}</span>
								<span className="truncate text-muted-foreground">{rule.targets}</span>
								{rule.triggered && (
									<Badge className="bg-red-100 text-red-800 border-red-200 dark:opacity-80 shrink-0">
										<Trans>Triggered</Trans>
									</Badge>
								)}
							</div>
							<span className="text-muted-foreground">
								{describeRule(rule)}
								{rule.cycles > 1 && ` · ${t`${rule.cycles} consecutive checks`}`}
							</span>
						</div>
						{!readOnly && (
							<div className="flex shrink-0">
								<Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(rule)} aria-label={t`Edit`}>
									<PencilIcon className="h-3.5 w-3.5" />
								</Button>
								<Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteRule(rule)} aria-label={t`Delete`}>
									<Trash2Icon className="h-3.5 w-3.5" />
								</Button>
							</div>
						)}
					</div>
				)
			)}

			{editing === "new" && (
				<RuleForm
					system={system}
					onDone={(saved) => {
						if (saved) setRule(saved)
						setEditing(null)
					}}
				/>
			)}
		</div>
	)
}

export function failedToast(e: unknown) {
	console.error(e)
	const message = (e as { response?: { message?: string } })?.response?.message
	toast({
		title: t`Failed to update alert`,
		description: message || t`Please check logs for more details.`,
		variant: "destructive",
	})
}

/** Names of services or containers reported for a system, used as target suggestions */
function useTargetNames(systemId: string, kind: Kind) {
	const [names, setNames] = useState<string[]>([])
	useEffect(() => {
		let active = true
		if (kind === "process") {
			pb.send<{ processes: { name: string }[] }>("/api/beszel/processes", { query: { system: systemId }, requestKey: null })
				.then((res) => active && setNames([...new Set(res.processes.map((p) => p.name))].sort()))
				.catch(() => active && setNames([]))
			return () => {
				active = false
			}
		}
		pb.collection<{ name: string }>(kind === "service" ? "systemd_services" : "containers")
			.getFullList({ fields: "name", filter: pb.filter("system={:system}", { system: systemId }) })
			.then((records) => active && setNames([...new Set(records.map((r) => r.name))].sort()))
			.catch(() => active && setNames([]))
		return () => {
			active = false
		}
	}, [systemId, kind])
	return names
}

function RuleForm({
	system,
	rule,
	onDone,
}: {
	system: SystemRecord
	rule?: StateAlertRecord
	onDone: (saved?: StateAlertRecord) => void
}) {
	const [draft, setDraft] = useState<RuleDraft>(() => (rule ? { ...rule } : newDraft()))
	const [saving, setSaving] = useState(false)
	const [showSuggestions, setShowSuggestions] = useState(false)
	const names = useTargetNames(system.id, draft.kind)
	const options = stateOptions[draft.kind]

	// suggest names containing the pattern being typed (after the last comma)
	const typed = draft.targets.split(",").at(-1)?.trim().toLowerCase() ?? ""
	const suggestions = useMemo(
		() => names.filter((name) => !typed || name.toLowerCase().includes(typed)).slice(0, 8),
		[names, typed]
	)

	function update(patch: Partial<RuleDraft>) {
		setDraft((current) => ({ ...current, ...patch }))
	}

	function toggle(field: "states" | "sub_states", value: string) {
		const values = draft[field]
		update({ [field]: values.includes(value) ? values.filter((v) => v !== value) : [...values, value] })
	}

	function addTarget(name: string) {
		const parts = draft.targets.split(",").map((p) => p.trim())
		parts[parts.length - 1] = name
		update({ targets: `${parts.filter(Boolean).join(", ")}, ` })
	}

	async function save() {
		setSaving(true)
		const body = {
			...draft,
			targets: draft.targets
				.split(",")
				.map((p) => p.trim())
				.filter(Boolean)
				.join(", "),
		}
		try {
			const saved = rule
				? await pb.collection<StateAlertRecord>(collection).update(rule.id, body)
				: await pb
						.collection<StateAlertRecord>(collection)
						.create({ ...body, system: system.id, user: pb.authStore.record?.id })
			onDone(saved)
		} catch (e) {
			failedToast(e)
		} finally {
			setSaving(false)
		}
	}

	const canSave = draft.targets.trim() !== "" && ruleIsComplete(draft)

	return (
		<div className="grid gap-4 rounded-md border p-3">
			<div className="grid sm:grid-cols-2 gap-3">
				<div className="grid gap-1.5">
					<Label htmlFor="sa-kind">
						<Trans>Type</Trans>
					</Label>
					<Select
						value={draft.kind}
						disabled={!!rule}
						onValueChange={(kind: Kind) => setDraft({ ...newDraft(kind), targets: draft.targets, cycles: draft.cycles })}
					>
						<SelectTrigger id="sa-kind">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="service">{kindLabel("service")}</SelectItem>
							<SelectItem value="container">{kindLabel("container")}</SelectItem>
							<SelectItem value="process">{kindLabel("process")}</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<div className={cn("grid gap-1.5", draft.kind === "process" && "hidden")}>
					<Label htmlFor="sa-condition">
						<Trans>Condition</Trans>
					</Label>
					<Select value={draft.condition} onValueChange={(condition: RuleDraft["condition"]) => update({ condition })}>
						<SelectTrigger id="sa-condition">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="is_not">
								<Trans>Alert when state is not</Trans>
							</SelectItem>
							<SelectItem value="is">
								<Trans>Alert when state is</Trans>
							</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>

			<div className="grid gap-1.5">
				<Label htmlFor="sa-targets">
					<Trans>Targets</Trans>
				</Label>
				<Input
					id="sa-targets"
					value={draft.targets}
					placeholder={
						draft.kind === "service" ? "nginx, sql*, Spooler" : draft.kind === "process" ? "sqlservr, java*, nginx" : "web*, postgres"
					}
					onChange={(e) => update({ targets: e.target.value })}
					onFocus={() => setShowSuggestions(true)}
					onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
					autoComplete="off"
				/>
				{showSuggestions && suggestions.length > 0 && (
					<div className="flex flex-wrap gap-1.5">
						{suggestions.map((name) => (
							<Button
								key={name}
								type="button"
								variant="secondary"
								size="sm"
								className="h-6 px-2 text-xs max-w-full"
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => addTarget(name)}
							>
								<span className="truncate">{name}</span>
							</Button>
						))}
					</div>
				)}
				<span className="text-xs text-muted-foreground">
					<Trans>
						Names separated by commas. Use * as a wildcard. A target that is no longer reported counts as stopped.
					</Trans>
				</span>
			</div>

			{draft.kind === "process" ? (
				<ProcessRuleFields draft={draft} onChange={setDraft} />
			) : (
				<>
					<StateChips
						label={t`States`}
						options={options.states}
						selected={draft.states}
						onToggle={(value) => toggle("states", value)}
					/>
					<StateChips
						label={draft.kind === "service" ? t`Sub-states (optional)` : t`Health (optional)`}
						options={options.subStates}
						selected={draft.sub_states}
						onToggle={(value) => toggle("sub_states", value)}
					/>
				</>
			)}

			<div className="grid gap-1.5 sm:w-1/2">
				<Label htmlFor="sa-cycles">
					<Trans>Consecutive checks</Trans>
				</Label>
				<Input
					id="sa-cycles"
					type="number"
					min={1}
					max={10}
					value={draft.cycles}
					onChange={(e) => {
						const cycles = parseInt(e.target.value, 10)
						if (!Number.isNaN(cycles)) update({ cycles: Math.max(1, Math.min(cycles, 10)) })
					}}
				/>
				<span className="text-xs text-muted-foreground">
					{draft.kind === "process" ? (
						<Trans>Processes are checked every minute, only on the systems with process rules.</Trans>
					) : (
						<Trans>Services are checked at each collection, containers every minute.</Trans>
					)}
				</span>
			</div>

			<div className="flex justify-end gap-2">
				<Button variant="ghost" size="sm" onClick={() => onDone()} disabled={saving}>
					<Trans>Cancel</Trans>
				</Button>
				<Button size="sm" onClick={save} disabled={saving || !canSave}>
					<Trans>Save</Trans>
				</Button>
			</div>
		</div>
	)
}

export function StateChips({
	label,
	options,
	selected,
	onToggle,
}: {
	label: string
	options: readonly string[]
	selected: string[]
	onToggle: (value: string) => void
}) {
	return (
		<div className="grid gap-1.5">
			<Label>{label}</Label>
			<div className="flex flex-wrap gap-1.5">
				{options.map((option) => {
					const value = option.toLowerCase()
					const active = selected.includes(value)
					return (
						<Button
							key={value}
							type="button"
							variant={active ? "default" : "outline"}
							size="sm"
							aria-pressed={active}
							className={cn("h-7 px-2.5 text-xs", !active && "text-muted-foreground")}
							onClick={() => onToggle(value)}
						>
							{option}
						</Button>
					)
				})}
			</div>
		</div>
	)
}
