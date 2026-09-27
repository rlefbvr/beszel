import { plural, t } from "@lingui/core/macro"
import { Plural, Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { CalendarIcon, LoaderCircleIcon, XIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/components/ui/use-toast"
import { pb } from "@/lib/api"
import { $quietHours } from "@/lib/quiet-hours"
import { $stateAlerts, chunkTargets } from "@/lib/state-alerts"
import { $allSystemsById } from "@/lib/stores"
import { cn } from "@/lib/utils"
import type { QuietHoursRecord, StateAlertRecord } from "@/types"
import { QuietHoursNotice, quietHoursOf, type RuleTarget } from "./alerts-notice"
import {
	newQuietHoursDraft,
	type QuietHoursDraft,
	QuietHoursFields,
	quietHoursDraftData,
	quietHoursDraftError,
} from "./quiet-hours-fields"
import {
	failedToast,
	type Kind,
	kindLabel,
	newDraft,
	ProcessRuleFields,
	type RuleDraft,
	ruleIsComplete,
	StateChips,
	stateOptions,
	useTargetNames,
} from "./state-rule-fields"

/** What the dialog works on: selected items, a system, or a rule */
export type RuleDialogSubject =
	/** "+ Alerts" of the tables: rules for the selected services, containers or processes of their systems */
	| { mode: "items"; kind: Kind; items: { name: string; system: string }[] }
	/** a new rule of a system, from the alerts of its page */
	| { mode: "system"; system: string; kind?: Kind }
	| { mode: "edit"; rule: StateAlertRecord }

/**
 * The dialog of the state rules, from the tables and from the alerts of a
 * host: the condition of the rule, its quiet hours, and the quiet hours
 * already set up for it.
 */
export function StateRuleDialog({ subject, onClose }: { subject: RuleDialogSubject; onClose: () => void }) {
	const systems = useStore($allSystemsById)
	const quietHours = useStore($quietHours)
	const allRules = useStore($stateAlerts)
	const editing = subject.mode === "edit" ? subject.rule : undefined
	const initialKind = subject.mode === "edit" ? subject.rule.kind : (subject.kind ?? "service")
	const [draft, setDraft] = useState<RuleDraft>(() => (editing ? { ...editing } : newDraft(initialKind)))
	const [quietDraft, setQuietDraft] = useState<QuietHoursDraft | null>(null)
	const [saving, setSaving] = useState(false)

	const systemId = subject.mode === "system" ? subject.system : editing?.system
	// names of each system for the selected items; names with a comma can't be a rule target
	const bySystem = useMemo(() => {
		if (subject.mode !== "items") {
			return []
		}
		const map = new Map<string, string[]>()
		for (const { name, system } of subject.items) {
			if (name.includes(",")) {
				continue
			}
			const names = map.get(system) ?? []
			if (!names.includes(name)) {
				names.push(name)
			}
			map.set(system, names)
		}
		return [...map.entries()].sort(([a], [b]) => (systems[a]?.name ?? a).localeCompare(systems[b]?.name ?? b))
	}, [subject, systems])
	const count = bySystem.reduce((total, [, names]) => total + names.length, 0)
	// names with a comma can't be targets, such as the shared service hosts of Windows
	const skipped =
		subject.mode === "items"
			? [...new Set(subject.items.filter((item) => item.name.includes(",")).map((item) => item.name))]
			: []
	const skippedCount = skipped.length
	const systemCount = bySystem.length

	// quiet hours already silencing the rule or the selected items
	const existingWindows = useMemo(() => {
		if (editing) {
			return quietHoursOf(quietHours, [allRules[editing.id] ?? editing])
		}
		if (subject.mode === "items") {
			const targets: RuleTarget[] = bySystem.flatMap(([system, names]) =>
				names.map((name) => ({ kind: subject.kind, name, system }))
			)
			return quietHoursOf(quietHours, [], targets)
		}
		return []
	}, [quietHours, allRules, editing, subject, bySystem])

	function toggle(field: "states" | "sub_states", value: string) {
		setDraft((current) => {
			const values = current[field]
			return { ...current, [field]: values.includes(value) ? values.filter((v) => v !== value) : [...values, value] }
		})
	}

	const quietError = quietDraft ? quietHoursDraftError(quietDraft) : ""
	const targetsOk = subject.mode === "items" ? count > 0 : draft.targets.trim() !== ""
	const canSave = targetsOk && ruleIsComplete({ ...draft, targets: draft.targets || "-" }) && !quietError

	/** the quiet hours of the dialog, limited to the rules saved */
	async function saveQuietHours(rules: StateAlertRecord[]) {
		if (!quietDraft) {
			return
		}
		const data = quietHoursDraftData(quietDraft)
		const bySystemRules = new Map<string, string[]>()
		for (const rule of rules) {
			bySystemRules.set(rule.system, [...(bySystemRules.get(rule.system) ?? []), rule.id])
		}
		for (const [system, ruleIds] of bySystemRules) {
			const window = await pb
				.collection<QuietHoursRecord>("quiet_hours")
				.create({ ...data, user: pb.authStore.record?.id, system, rules: ruleIds })
			$quietHours.setKey(window.id, window)
		}
	}

	async function save(e: React.FormEvent) {
		e.preventDefault()
		setSaving(true)
		try {
			const userId = pb.authStore.record?.id
			const collection = pb.collection<StateAlertRecord>("state_alerts")
			const body = {
				...draft,
				targets: draft.targets
					.split(",")
					.map((p) => p.trim())
					.filter(Boolean)
					.join(", "),
			}
			let saved: StateAlertRecord[]
			if (editing) {
				saved = [await collection.update(editing.id, body)]
			} else if (subject.mode === "system") {
				saved = [await collection.create({ ...body, system: subject.system, user: userId })]
			} else {
				saved = await Promise.all(
					bySystem.flatMap(([system, names]) =>
						chunkTargets(names).map((targets) => collection.create({ ...draft, targets, system, user: userId }))
					)
				)
			}
			for (const rule of saved) {
				$stateAlerts.setKey(rule.id, rule)
			}
			await saveQuietHours(saved)
			if (!editing) {
				const ruleCount = saved.length
				toast({
					title: t`Alerts created`,
					description: plural(ruleCount, { one: "# state rule created.", other: "# state rules created." }),
				})
			}
			onClose()
		} catch (err) {
			failedToast(err)
		} finally {
			setSaving(false)
		}
	}

	const kind = draft.kind
	const options = stateOptions[kind]
	const systemName = systemId ? (systems[systemId]?.name ?? systemId) : ""

	return (
		<DialogContent className="w-[calc(100vw-2rem)] max-w-xl max-h-[calc(100dvh-2rem)] overflow-y-auto">
			<DialogHeader>
				<DialogTitle>
					{editing ? (
						<Trans>Edit the rule</Trans>
					) : kind === "service" ? (
						<Trans>Service alerts</Trans>
					) : kind === "process" ? (
						<Trans>Process alerts</Trans>
					) : (
						<Trans>Container alerts</Trans>
					)}
				</DialogTitle>
				<DialogDescription>
					{subject.mode === "items" ? (
						<>
							{kind === "service" ? (
								<Plural value={count} one="# filtered service" other="# filtered services" />
							) : kind === "process" ? (
								<Plural value={count} one="# selected process" other="# selected processes" />
							) : (
								<Plural value={count} one="# filtered container" other="# filtered containers" />
							)}
							{" · "}
							<Plural value={systemCount} one="# system" other="# systems" />
							{". "}
							<Trans>The rules are created on each system.</Trans>
						</>
					) : (
						systemName
					)}
				</DialogDescription>
			</DialogHeader>

			<form onSubmit={save} className="grid gap-4">
				{subject.mode !== "items" && (
					<RuleTargets systemId={systemId ?? ""} draft={draft} fixedKind={!!editing} onChange={setDraft} />
				)}

				{kind === "process" ? (
					<ProcessRuleFields draft={draft} onChange={setDraft} />
				) : (
					<>
						<div className="grid gap-1.5">
							<Label htmlFor="rule-condition">
								<Trans>Condition</Trans>
							</Label>
							<Select
								value={draft.condition}
								onValueChange={(condition: RuleDraft["condition"]) => setDraft((current) => ({ ...current, condition }))}
							>
								<SelectTrigger id="rule-condition">
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
						<StateChips label={t`States`} options={options.states} selected={draft.states} onToggle={(v) => toggle("states", v)} />
						<StateChips
							label={kind === "service" ? t`Sub-states (optional)` : t`Health (optional)`}
							options={options.subStates}
							selected={draft.sub_states}
							onToggle={(v) => toggle("sub_states", v)}
						/>
					</>
				)}

				<div className="grid gap-1.5 sm:w-1/2">
					<Label htmlFor="rule-cycles">
						<Trans>Consecutive checks</Trans>
					</Label>
					<Input
						id="rule-cycles"
						type="number"
						min={1}
						max={10}
						value={draft.cycles}
						onChange={(e) => {
							const cycles = Number.parseInt(e.target.value, 10)
							if (!Number.isNaN(cycles)) {
								setDraft((current) => ({ ...current, cycles: Math.max(1, Math.min(cycles, 10)) }))
							}
						}}
					/>
					<span className="text-xs text-muted-foreground">
						{kind === "process" ? (
							<Trans>Processes are checked every minute, only on the systems with process rules.</Trans>
						) : (
							<Trans>Services are checked at each collection, containers every minute.</Trans>
						)}
					</span>
				</div>

				{subject.mode === "items" && (
					<div className="grid gap-1.5">
						<p className="text-sm font-medium">
							<Trans>Targets by system</Trans>
						</p>
						{skippedCount > 0 && (
							<p className="text-xs text-muted-foreground" title={skipped.join(" · ")}>
								<Plural
									value={skippedCount}
									one="# item left out: a name with a comma can't be the target of a rule."
									other="# items left out: a name with a comma can't be the target of a rule."
								/>
							</p>
						)}
						<ul className="grid gap-1.5 max-h-40 overflow-y-auto rounded-md border p-3 text-sm empty:hidden">
							{bySystem.map(([system, names]) => (
								<li key={system} className="grid">
									<span className="font-medium">{systems[system]?.name ?? system}</span>
									<span className="text-muted-foreground break-words">{names.join(", ")}</span>
								</li>
							))}
						</ul>
					</div>
				)}

				{/* quiet hours of the rules */}
				{quietDraft ? (
					<div className="grid gap-3 rounded-md border p-3">
						<div className="flex items-center gap-2">
							<CalendarIcon className="size-4 text-muted-foreground" />
							<span className="text-sm font-medium me-auto">
								<Trans>Set up quiet hours</Trans>
							</span>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="size-7"
								aria-label={t`Cancel`}
								onClick={() => setQuietDraft(null)}
							>
								<XIcon className="size-4" />
							</Button>
						</div>
						<p className="text-xs text-muted-foreground -mt-1">
							<Trans>The alerts of these rules are not sent during this window. It goes with the rules when they are deleted.</Trans>
						</p>
						<QuietHoursFields draft={quietDraft} onChange={setQuietDraft} />
						{quietError && <p className="text-xs text-destructive">{quietError}</p>}
					</div>
				) : (
					<Button
						type="button"
						variant="outline"
						className="justify-self-start gap-2"
						onClick={() => setQuietDraft(newQuietHoursDraft())}
					>
						<CalendarIcon className="size-4" />
						<Trans>Set up quiet hours</Trans>
					</Button>
				)}

				<QuietHoursNotice windows={existingWindows} ruleIds={editing ? [editing.id] : []} />

				<DialogFooter>
					<Button type="button" variant="outline" onClick={onClose} disabled={saving}>
						<Trans>Cancel</Trans>
					</Button>
					<Button type="submit" disabled={saving || !canSave} className="gap-2">
						{saving && <LoaderCircleIcon className="size-4 animate-spin" />}
						{editing ? <Trans>Save</Trans> : <Trans>Create</Trans>}
					</Button>
				</DialogFooter>
			</form>
		</DialogContent>
	)
}

/** Kind and targets of a rule of one system, with the names reported by the system as suggestions */
function RuleTargets({
	systemId,
	draft,
	fixedKind,
	onChange,
}: {
	systemId: string
	draft: RuleDraft
	fixedKind: boolean
	onChange: (draft: RuleDraft) => void
}) {
	const [showSuggestions, setShowSuggestions] = useState(false)
	const names = useTargetNames(systemId, draft.kind)
	// suggest names containing the pattern being typed (after the last comma)
	const typed = draft.targets.split(",").at(-1)?.trim().toLowerCase() ?? ""
	const suggestions = useMemo(
		() => names.filter((name) => !typed || name.toLowerCase().includes(typed)).slice(0, 8),
		[names, typed]
	)

	function addTarget(name: string) {
		const parts = draft.targets.split(",").map((p) => p.trim())
		parts[parts.length - 1] = name
		onChange({ ...draft, targets: `${parts.filter(Boolean).join(", ")}, ` })
	}

	return (
		<>
			<div className="grid gap-1.5">
				<Label htmlFor="rule-kind">
					<Trans>Type</Trans>
				</Label>
				<Select
					value={draft.kind}
					disabled={fixedKind}
					onValueChange={(kind: Kind) => onChange({ ...newDraft(kind), targets: draft.targets, cycles: draft.cycles })}
				>
					<SelectTrigger id="rule-kind">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="service">{kindLabel("service")}</SelectItem>
						<SelectItem value="container">{kindLabel("container")}</SelectItem>
						<SelectItem value="process">{kindLabel("process")}</SelectItem>
					</SelectContent>
				</Select>
			</div>
			<div className="grid gap-1.5">
				<Label htmlFor="rule-targets">
					<Trans>Targets</Trans>
				</Label>
				<Input
					id="rule-targets"
					value={draft.targets}
					placeholder={
						draft.kind === "service" ? "nginx, sql*, Spooler" : draft.kind === "process" ? "sqlservr, java*, nginx" : "web*, postgres"
					}
					onChange={(e) => onChange({ ...draft, targets: e.target.value })}
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
								className={cn("h-6 px-2 text-xs max-w-full")}
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
		</>
	)
}
