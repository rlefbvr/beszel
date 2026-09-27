import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { BellRingIcon, MoonIcon, PencilIcon, Trash2Icon, XIcon } from "lucide-react"
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { pb } from "@/lib/api"
import {
	$quietHours,
	quietHoursReasonLabel,
	quietHoursScheduleText,
	quietHoursScoped,
	quietHoursState,
} from "@/lib/quiet-hours"
import { ruleMatchesName, stateRuleAlertKind } from "@/lib/state-alerts"
import { useNow } from "@/lib/time"
import { formatShortDate } from "@/lib/utils"
import type { QuietHoursRecord, StateAlertRecord } from "@/types"
import { describeRule, failedToast } from "./state-rule-fields"

/** A service, container or process of a system */
export interface RuleTarget {
	kind: StateAlertRecord["kind"]
	name: string
	system: string
}

/**
 * Quiet hours windows silencing the alerts of some state rules or targets:
 * limited to one of the rules or targets, or silencing all the alerts, or the
 * state alerts of their kind, of the system or of all the systems.
 */
export function quietHoursOf(
	records: Record<string, QuietHoursRecord>,
	rules: StateAlertRecord[],
	targets: RuleTarget[] = []
) {
	const ruleIds = new Set(rules.map((rule) => rule.id))
	const systems = new Set([...rules.map((rule) => rule.system), ...targets.map((target) => target.system)])
	const kinds = new Set([...rules.map((rule) => rule.kind), ...targets.map((target) => target.kind)])
	return Object.values(records)
		.filter((record) => {
			if (record.sensor || (record.system && !systems.has(record.system))) {
				return false
			}
			if (!quietHoursScoped(record)) {
				return true
			}
			if ((record.rules ?? []).some((id) => ruleIds.has(id))) {
				return true
			}
			if ([...kinds].some((kind) => record.alerts?.includes(stateRuleAlertKind(kind)))) {
				return true
			}
			// windows set up from the selection of the services, containers or processes
			return (record.targets ?? []).some(
				(windowTarget) =>
					targets.some(
						(target) =>
							target.kind === windowTarget.kind &&
							target.system === record.system &&
							target.name.toLowerCase() === windowTarget.name.toLowerCase()
					) ||
					rules.some(
						(rule) =>
							rule.kind === windowTarget.kind && rule.system === record.system && ruleMatchesName(rule, windowTarget.name)
					)
			)
		})
		.sort((a, b) => a.start.localeCompare(b.start))
}

/**
 * Quiet hours already set up for the rules or targets of a dialog, shown like
 * the banner of the active quiet hours: blue border and moon. The windows
 * limited to these rules can be removed.
 */
export function QuietHoursNotice({ windows, ruleIds = [] }: { windows: QuietHoursRecord[]; ruleIds?: string[] }) {
	const now = useNow()
	const [removing, setRemoving] = useState("")
	if (!windows.length) {
		return null
	}

	/** windows limited to the rules of the dialog, that nothing else needs */
	const removable = (record: QuietHoursRecord) =>
		!!record.rules?.length &&
		record.rules.every((id) => ruleIds.includes(id)) &&
		!record.alerts?.length &&
		!record.targets?.length

	async function remove(record: QuietHoursRecord) {
		setRemoving(record.id)
		try {
			await pb.collection("quiet_hours").delete(record.id)
			const { [record.id]: _, ...rest } = $quietHours.get()
			$quietHours.set(rest)
		} catch (e) {
			failedToast(e)
		} finally {
			setRemoving("")
		}
	}

	return (
		<div className="flex gap-3 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-4 py-3 text-sm">
			<MoonIcon className="size-5 shrink-0 text-indigo-600 dark:text-indigo-400" />
			<div className="grid gap-1 min-w-0 flex-1">
				<p className="font-medium">
					<Trans>Quiet hours set up: the alerts are not sent during these windows</Trans>
				</p>
				<ul className="grid gap-1">
					{windows.map((record) => {
						const reason = quietHoursReasonLabel(record.reason)
						const active = quietHoursState(record, now) === "active"
						return (
							<li key={record.id} className="flex items-center gap-2 min-w-0">
								<span className="truncate">
									{quietHoursScheduleText(record, formatShortDate)}
									{!record.system && <span className="text-muted-foreground"> · {t`All Systems`}</span>}
									{reason && <span className="text-muted-foreground"> · {reason}</span>}
								</span>
								{active && (
									<Badge variant="success" className="shrink-0">
										<Trans>Active</Trans>
									</Badge>
								)}
								{removable(record) && (
									<button
										type="button"
										className="ms-auto shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
										aria-label={t`Delete`}
										title={t`Delete`}
										disabled={removing === record.id}
										onClick={() => remove(record)}
									>
										<XIcon className="size-3.5" />
									</button>
								)}
							</li>
						)
					})}
				</ul>
			</div>
		</div>
	)
}

/**
 * State rules of a target, framed in blue with a bell like the quiet hours
 * banner, each one with its edit and delete buttons.
 */
export function RulesNotice({
	rules,
	onEdit,
	onDelete,
}: {
	rules: StateAlertRecord[]
	onEdit?: (rule: StateAlertRecord) => void
	onDelete?: (rule: StateAlertRecord) => void
}) {
	if (!rules.length) {
		return null
	}
	return (
		<div className="flex gap-3 rounded-lg border border-sky-500/40 bg-sky-500/10 px-4 py-3 text-sm">
			<BellRingIcon className="size-5 shrink-0 text-sky-600 dark:text-sky-400" />
			<div className="grid gap-1 min-w-0 flex-1">
				<p className="font-medium">
					<Trans>Alerts set up</Trans>
				</p>
				<ul className="grid gap-1">
					{rules.map((rule) => (
						<li key={rule.id} className="flex items-center gap-2 min-w-0">
							{rule.name && <span className="font-medium truncate shrink-0 max-w-[40%]">{rule.name}</span>}
							<span className="truncate first-letter:uppercase">{describeRule(rule)}</span>
							<span className="truncate text-muted-foreground">· {rule.targets}</span>
							{rule.triggered && (
								<Badge className="bg-red-100 text-red-800 border-red-200 dark:opacity-80 shrink-0">
									<Trans>Triggered</Trans>
								</Badge>
							)}
							<span className="ms-auto flex shrink-0">
								{onEdit && (
									<button
										type="button"
										className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
										aria-label={t`Edit`}
										title={t`Edit`}
										onClick={() => onEdit(rule)}
									>
										<PencilIcon className="size-3.5" />
									</button>
								)}
								{onDelete && (
									<button
										type="button"
										className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
										aria-label={t`Delete`}
										title={t`Delete`}
										onClick={() => onDelete(rule)}
									>
										<Trash2Icon className="size-3.5" />
									</button>
								)}
							</span>
						</li>
					))}
				</ul>
			</div>
		</div>
	)
}
