import { t } from "@lingui/core/macro"
import { Plural, Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { ActivityIcon, MoonIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { useMemo, useState } from "react"
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { isReadOnlyUser, pb } from "@/lib/api"
import { $quietHours } from "@/lib/quiet-hours"
import { $stateAlerts, systemStateAlerts } from "@/lib/state-alerts"
import type { StateAlertRecord, SystemRecord } from "@/types"
import { quietHoursOf } from "./alerts-notice"
import { type RuleDialogSubject, StateRuleDialog } from "./state-rule-dialog"
import { describeRule, failedToast, kindLabel } from "./state-rule-fields"

export {
	describeRule,
	failedToast,
	newDraft,
	ProcessRuleFields,
	type RuleDraft,
	ruleIsComplete,
	StateChips,
	stateOptions,
} from "./state-rule-fields"

const collection = "state_alerts"

/** Per-system rules alerting on service, Docker container or process states */
export function StateAlertRules({ system }: { system: SystemRecord }) {
	// kept in sync by the shared store, including triggered flags set by the hub
	const allRules = useStore($stateAlerts)
	const quietHours = useStore($quietHours)
	const rules = useMemo(() => systemStateAlerts(allRules, system.id), [allRules, system.id])
	const [dialog, setDialog] = useState<RuleDialogSubject | null>(null)
	const [deleting, setDeleting] = useState<StateAlertRecord | null>(null)
	const readOnly = isReadOnlyUser()

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
				{!readOnly && (
					<Button
						variant="outline"
						size="sm"
						className="gap-1.5 shrink-0"
						onClick={() => setDialog({ mode: "system", system: system.id })}
					>
						<PlusIcon className="h-3.5 w-3.5" />
						<Trans>Add rule</Trans>
					</Button>
				)}
			</div>

			{rules.map((rule) => {
				const windows = quietHoursOf(quietHours, [rule]).filter((window) => window.rules?.includes(rule.id))
				return (
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
								{windows.length > 0 && (
									<MoonIcon
										className="size-3.5 shrink-0 text-indigo-600 dark:text-indigo-400"
										aria-label={t`Quiet hours`}
									/>
								)}
							</div>
							<span className="text-muted-foreground">
								{describeRule(rule)}
								{rule.cycles > 1 && ` · ${t`${rule.cycles} consecutive checks`}`}
							</span>
						</div>
						{!readOnly && (
							<div className="flex shrink-0">
								<Button
									variant="ghost"
									size="icon"
									className="h-8 w-8"
									onClick={() => setDialog({ mode: "edit", rule })}
									aria-label={t`Edit`}
								>
									<PencilIcon className="h-3.5 w-3.5" />
								</Button>
								<Button
									variant="ghost"
									size="icon"
									className="h-8 w-8"
									onClick={() => setDeleting(rule)}
									aria-label={t`Delete`}
								>
									<Trash2Icon className="h-3.5 w-3.5" />
								</Button>
							</div>
						)}
					</div>
				)
			})}

			<Dialog open={!!dialog} onOpenChange={(open) => !open && setDialog(null)}>
				{dialog && <StateRuleDialog subject={dialog} onClose={() => setDialog(null)} />}
			</Dialog>
			{deleting && <DeleteRuleDialog rule={deleting} onClose={() => setDeleting(null)} />}
		</div>
	)
}

/** Confirms the deletion of a rule, which deletes its quiet hours too */
export function DeleteRuleDialog({ rule, onClose }: { rule: StateAlertRecord; onClose: () => void }) {
	const quietHours = useStore($quietHours)
	const [saving, setSaving] = useState(false)
	const windowCount = Object.values(quietHours).filter((window) => window.rules?.includes(rule.id)).length
	const targets = rule.targets
	const condition = describeRule(rule)

	async function remove() {
		setSaving(true)
		try {
			await pb.collection(collection).delete(rule.id)
			const { [rule.id]: _, ...rest } = $stateAlerts.get()
			$stateAlerts.set(rest)
			onClose()
		} catch (e) {
			failedToast(e)
		} finally {
			setSaving(false)
		}
	}

	return (
		<AlertDialog open onOpenChange={(open) => !open && onClose()}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						<Trans>Delete the rule?</Trans>
					</AlertDialogTitle>
					<AlertDialogDescription>
						<Trans>
							{targets}: {condition}. Its alerts stop.
						</Trans>
						{windowCount > 0 && (
							<>
								{" "}
								<Plural
									value={windowCount}
									one="Its quiet hours window is deleted too."
									other="Its # quiet hours windows are deleted too."
								/>
							</>
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={saving}>
						<Trans>Cancel</Trans>
					</AlertDialogCancel>
					<AlertDialogAction
						disabled={saving}
						onClick={(e) => {
							e.preventDefault()
							remove()
						}}
					>
						<Trans>Delete</Trans>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
