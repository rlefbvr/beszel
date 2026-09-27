import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import type { ColumnDef } from "@tanstack/react-table"
import { PlusIcon } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog } from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { isReadOnlyUser } from "@/lib/api"
import type { StateAlertRecord } from "@/types"
import { StateRuleDialog } from "./state-rule-dialog"

type Kind = StateAlertRecord["kind"]

/** Row id of a service or container, stable across refreshes: its system and name */
export const targetRowId = (item: { name: string; system: string }) => `${item.system}/${item.name}`

/**
 * First column of the services and containers tables: checkboxes choosing the
 * items the "+ Alerts" button applies to. The header checkbox selects the
 * filtered rows.
 */
export function selectionColumn<T>(): ColumnDef<T> {
	return {
		id: "select",
		size: 40,
		enableSorting: false,
		enableHiding: false,
		header: ({ table }) => {
			const rows = table.getFilteredRowModel().rows
			const selectedCount = rows.filter((row) => row.getIsSelected()).length
			const checked = selectedCount === 0 ? false : selectedCount === rows.length ? true : "indeterminate"
			return (
				<Checkbox
					className="ms-1.5 data-[state=indeterminate]:bg-primary/50 data-[state=indeterminate]:text-primary-foreground"
					aria-label={t`Select all`}
					checked={checked}
					disabled={!rows.length}
					onCheckedChange={(value) =>
						table.setRowSelection((current) => {
							const next = { ...current }
							for (const row of rows) {
								if (value === true) {
									next[row.id] = true
								} else {
									delete next[row.id]
								}
							}
							return next
						})
					}
				/>
			)
		},
		cell: ({ row }) => (
			<Checkbox
				className="ms-1.5"
				aria-label={t`Select`}
				checked={row.getIsSelected()}
				// the row opens its details when clicked
				onClick={(e) => e.stopPropagation()}
				onCheckedChange={(value) => row.toggleSelected(value === true)}
			/>
		),
	}
}

/**
 * "+ Alerts" button of the services and containers tables: creates state rules
 * for the selected items, one set of rules per system.
 */
export function BulkStateAlertsButton({ kind, items }: { kind: Kind; items: { name: string; system: string }[] }) {
	const [open, setOpen] = useState(false)
	if (isReadOnlyUser()) {
		return null
	}
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<Tooltip>
				<TooltipTrigger asChild>
					{/* span: disabled buttons don't trigger tooltips */}
					<span className="inline-flex shrink-0">
						<Button variant="outline" className="gap-1.5" disabled={!items.length} onClick={() => setOpen(true)}>
							<PlusIcon className="size-4" />
							<Trans>Alerts</Trans>
							{items.length > 0 && <span className="text-muted-foreground tabular-nums">({items.length})</span>}
						</Button>
					</span>
				</TooltipTrigger>
				<TooltipContent>
					<Trans>Apply alerts to the selection below</Trans>
				</TooltipContent>
			</Tooltip>
			{open && <StateRuleDialog subject={{ mode: "items", kind, items }} onClose={() => setOpen(false)} />}
		</Dialog>
	)
}
