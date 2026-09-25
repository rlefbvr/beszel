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
export type RuleDraft = Pick<StateAlertRecord, "kind" | "targets" | "condition" | "states" | "sub_states" | "cycles">

const collection = "state_alerts"

/** Selectable states per rule kind; values match the hub's lowercase keys */
export const stateOptions: Record<Kind, { states: readonly string[]; subStates: readonly string[] }> = {
	service: { states: ServiceStatusLabels, subStates: ServiceSubStateLabels },
	container: { states: ["Running", "Paused", "Restarting", "Stopped"], subStates: ContainerHealthLabels },
}

export const newDraft = (kind: Kind = "service"): RuleDraft => ({
	kind,
	targets: "",
	condition: "is_not",
	states: kind === "service" ? ["active"] : ["running"],
	sub_states: [],
	cycles: 1,
})

const kindLabel = (kind: Kind) => (kind === "service" ? t`Services` : t`Containers`)

function describeRule(rule: RuleDraft) {
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
						<Trans>Alert when services or Docker containers enter or leave a state.</Trans>
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

	const canSave = draft.targets.trim() !== "" && (draft.states.length > 0 || draft.sub_states.length > 0)

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
						</SelectContent>
					</Select>
				</div>
				<div className="grid gap-1.5">
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
					placeholder={draft.kind === "service" ? "nginx, sql*, Spooler" : "web*, postgres"}
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
					<Trans>Services are checked at each collection, containers every minute.</Trans>
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
