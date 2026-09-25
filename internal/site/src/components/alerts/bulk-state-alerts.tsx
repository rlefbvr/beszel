import { plural, t } from "@lingui/core/macro"
import { Plural, Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import type { ColumnDef } from "@tanstack/react-table"
import { LoaderCircleIcon, PlusIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { toast } from "@/components/ui/use-toast"
import { isReadOnlyUser, pb } from "@/lib/api"
import { $stateAlerts, chunkTargets } from "@/lib/state-alerts"
import { $allSystemsById } from "@/lib/stores"
import type { StateAlertRecord } from "@/types"
import { failedToast, newDraft, type RuleDraft, StateChips, stateOptions } from "./state-alert-rules"

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
			{open && <BulkStateAlertsDialog kind={kind} items={items} onClose={() => setOpen(false)} />}
		</Dialog>
	)
}

function BulkStateAlertsDialog({
	kind,
	items,
	onClose,
}: {
	kind: Kind
	items: { name: string; system: string }[]
	onClose: () => void
}) {
	const systems = useStore($allSystemsById)
	const [draft, setDraft] = useState<RuleDraft>(() => newDraft(kind))
	const [saving, setSaving] = useState(false)
	const options = stateOptions[kind]

	// names of each system; names containing a comma can't be a rule target
	const bySystem = useMemo(() => {
		const map = new Map<string, string[]>()
		for (const { name, system } of items) {
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
	}, [items, systems])

	const count = bySystem.reduce((total, [, names]) => total + names.length, 0)
	const systemCount = bySystem.length

	function toggle(field: "states" | "sub_states", value: string) {
		setDraft((current) => {
			const values = current[field]
			return { ...current, [field]: values.includes(value) ? values.filter((v) => v !== value) : [...values, value] }
		})
	}

	async function save() {
		setSaving(true)
		try {
			const userId = pb.authStore.record?.id
			const created = await Promise.all(
				bySystem.flatMap(([system, names]) =>
					chunkTargets(names).map((targets) =>
						pb.collection<StateAlertRecord>("state_alerts").create({ ...draft, targets, system, user: userId })
					)
				)
			)
			for (const rule of created) {
				$stateAlerts.setKey(rule.id, rule)
			}
			const ruleCount = created.length
			toast({
				title: t`Alerts created`,
				description: plural(ruleCount, { one: "# state rule created.", other: "# state rules created." }),
			})
			onClose()
		} catch (e) {
			failedToast(e)
		} finally {
			setSaving(false)
		}
	}

	const canSave = count > 0 && (draft.states.length > 0 || draft.sub_states.length > 0)

	return (
		<DialogContent className="max-w-xl">
			<DialogHeader>
				<DialogTitle>{kind === "service" ? <Trans>Service alerts</Trans> : <Trans>Container alerts</Trans>}</DialogTitle>
				<DialogDescription>
					{kind === "service" ? (
						<Plural value={count} one="# filtered service" other="# filtered services" />
					) : (
						<Plural value={count} one="# filtered container" other="# filtered containers" />
					)}
					{" · "}
					<Plural value={systemCount} one="# system" other="# systems" />
					{". "}
					<Trans>The rules are created on each system.</Trans>
				</DialogDescription>
			</DialogHeader>

			<div className="grid gap-4">
				<div className="grid gap-1.5">
					<Label htmlFor="bulk-condition">
						<Trans>Condition</Trans>
					</Label>
					<Select
						value={draft.condition}
						onValueChange={(condition: RuleDraft["condition"]) => setDraft((current) => ({ ...current, condition }))}
					>
						<SelectTrigger id="bulk-condition">
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
				<div className="grid gap-1.5 sm:w-1/2">
					<Label htmlFor="bulk-cycles">
						<Trans>Consecutive checks</Trans>
					</Label>
					<Input
						id="bulk-cycles"
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
				</div>
				<div className="grid gap-1.5">
					<p className="text-sm font-medium">
						<Trans>Targets by system</Trans>
					</p>
					<ul className="grid gap-1.5 max-h-40 overflow-y-auto rounded-md border p-3 text-sm">
						{bySystem.map(([system, names]) => (
							<li key={system} className="grid">
								<span className="font-medium">{systems[system]?.name ?? system}</span>
								<span className="text-muted-foreground break-words">{names.join(", ")}</span>
							</li>
						))}
					</ul>
				</div>
			</div>

			<DialogFooter>
				<Button variant="outline" onClick={onClose} disabled={saving}>
					<Trans>Cancel</Trans>
				</Button>
				<Button onClick={save} disabled={saving || !canSave}>
					{saving && <LoaderCircleIcon className="size-4 animate-spin" />}
					<Trans>Create</Trans>
				</Button>
			</DialogFooter>
		</DialogContent>
	)
}
