import { Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { PlusIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { isReadOnlyUser } from "@/lib/api"
import { $quietHours } from "@/lib/quiet-hours"
import { $stateAlerts, ruleMatchesName } from "@/lib/state-alerts"
import type { StateAlertRecord } from "@/types"
import { QuietHoursNotice, quietHoursOf, type RuleTarget, RulesNotice } from "./alerts-notice"
import { DeleteRuleDialog } from "./state-alert-rules"
import { type RuleDialogSubject, StateRuleDialog } from "./state-rule-dialog"

/**
 * Alerts of a service, container or process in its details: its state rules
 * (framed in blue, to edit or delete them), the quiet hours silencing them,
 * and the "+ Alert" button creating a rule for it.
 */
export function TargetAlerts({ target }: { target: RuleTarget }) {
	const allRules = useStore($stateAlerts)
	const quietHours = useStore($quietHours)
	const [dialog, setDialog] = useState<RuleDialogSubject | null>(null)
	const [deleting, setDeleting] = useState<StateAlertRecord | null>(null)
	const readOnly = isReadOnlyUser()
	const { kind, name, system } = target

	const rules = useMemo(
		() =>
			Object.values(allRules).filter(
				(rule) => rule.kind === kind && rule.system === system && ruleMatchesName(rule, name)
			),
		[allRules, kind, name, system]
	)
	const windows = useMemo(() => quietHoursOf(quietHours, rules, [target]), [quietHours, rules, target])

	return (
		<div className="grid gap-2">
			<RulesNotice
				rules={rules}
				onEdit={readOnly ? undefined : (rule) => setDialog({ mode: "edit", rule })}
				onDelete={readOnly ? undefined : setDeleting}
			/>
			{/* the quiet hours only matter to an object with alerts */}
			{rules.length > 0 && <QuietHoursNotice windows={windows} ruleIds={rules.map((rule) => rule.id)} />}
			{!readOnly && (
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
					<Button
						variant="outline"
						size="sm"
						className="gap-1.5"
						// the targets of a rule are separated by commas
						disabled={name.includes(",")}
						onClick={() => setDialog({ mode: "items", kind, items: [{ name, system }] })}
					>
						<PlusIcon className="size-4" />
						<Trans>Alert</Trans>
					</Button>
					{name.includes(",") && (
						<span className="text-xs text-muted-foreground">
							<Trans>A name with a comma can't be the target of a rule.</Trans>
						</span>
					)}
				</div>
			)}
			<Dialog open={!!dialog} onOpenChange={(open) => !open && setDialog(null)}>
				{dialog && <StateRuleDialog subject={dialog} onClose={() => setDialog(null)} />}
			</Dialog>
			{deleting && <DeleteRuleDialog rule={deleting} onClose={() => setDeleting(null)} />}
		</div>
	)
}
