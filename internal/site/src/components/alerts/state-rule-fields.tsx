import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/components/ui/use-toast"
import { pb } from "@/lib/api"
import { ContainerHealthLabels, ServiceStatusLabels, ServiceSubStateLabels } from "@/lib/enums"
import { cn } from "@/lib/utils"
import type { StateAlertRecord } from "@/types"

export type Kind = StateAlertRecord["kind"]
export type RuleDraft = Pick<
	StateAlertRecord,
	"kind" | "targets" | "condition" | "states" | "sub_states" | "cycles" | "metric" | "threshold"
>

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

export const kindLabel = (kind: Kind) =>
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
export function useTargetNames(systemId: string, kind: Kind) {
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
