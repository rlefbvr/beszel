import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { FolderIcon, LoaderCircleIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { type ReactNode, useMemo, useState } from "react"
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
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/use-toast"
import { $sensorGroups, $sensors, saveSensorGroups } from "@/lib/sensors"
import { $systems } from "@/lib/stores"
import { $systemGroups, saveSystemGroups, systemGroup } from "@/lib/system-groups"
import { cn } from "@/lib/utils"

/** Group being edited: original is null for a new group */
interface GroupDraft {
	original: string | null
	name: string
	members: Set<string>
}

/** An item that belongs to a group: a system or a sensor */
interface GroupItem {
	id: string
	name: string
	group: string
}

/** Texts of the dialog, for systems or sensors */
interface GroupTexts {
	description: ReactNode
	items: ReactNode
	oneGroup: ReactNode
	kept: ReactNode
	deleted: () => string
}

/** Groups of the systems of the home page */
export function ManageGroupsDialog({ initialGroup, onDone }: { initialGroup?: string; onDone: () => void }) {
	const systems = useStore($systems)
	const groups = useStore($systemGroups)
	const items = useMemo(
		() => systems.map((system) => ({ id: system.id, name: system.name, group: systemGroup(system) })),
		[systems]
	)
	return (
		<GroupsDialog
			items={items}
			groups={groups}
			save={saveSystemGroups}
			initialGroup={initialGroup}
			onDone={onDone}
			texts={{
				description: (
					<Trans>
						Groups organize the systems on the home page for all users. Deleting a group keeps its systems, without
						group.
					</Trans>
				),
				items: <Trans>Systems</Trans>,
				oneGroup: <Trans>A system belongs to one group: checking it moves it from its current group.</Trans>,
				kept: <Trans>Its systems are kept and moved to no group.</Trans>,
				deleted: () => t`Its systems are now without group.`,
			}}
		/>
	)
}

/** Groups of the network sensors */
export function ManageSensorGroupsDialog({ initialGroup, onDone }: { initialGroup?: string; onDone: () => void }) {
	const sensors = useStore($sensors)
	const groups = useStore($sensorGroups)
	const items = useMemo(
		() =>
			Object.values(sensors).map((sensor) => ({ id: sensor.id, name: sensor.name, group: sensor.group?.trim() ?? "" })),
		[sensors]
	)
	return (
		<GroupsDialog
			items={items}
			groups={groups}
			save={saveSensorGroups}
			initialGroup={initialGroup}
			onDone={onDone}
			texts={{
				description: (
					<Trans>
						Groups organize the network sensors for all users. Deleting a group keeps its sensors, without group.
					</Trans>
				),
				items: <Trans>Sensors</Trans>,
				oneGroup: <Trans>A sensor belongs to one group: checking it moves it from its current group.</Trans>,
				kept: <Trans>Its sensors are kept and moved to no group.</Trans>,
				deleted: () => t`Its sensors are now without group.`,
			}}
		/>
	)
}

/**
 * Creates, renames and deletes groups, and chooses their items. Groups only
 * exist through their items: deleting a group moves its items to no group.
 */
function GroupsDialog({
	items,
	groups,
	save: saveChanges,
	initialGroup,
	onDone,
	texts,
}: {
	items: GroupItem[]
	groups: string[]
	save: (changes: { id: string; group: string }[]) => Promise<void>
	initialGroup?: string
	onDone: () => void
	texts: GroupTexts
}) {
	const [draft, setDraft] = useState<GroupDraft>(() => editGroup(initialGroup ?? groups[0] ?? null))
	const [search, setSearch] = useState("")
	const [saving, setSaving] = useState(false)
	const [confirmDelete, setConfirmDelete] = useState(false)

	function editGroup(group: string | null): GroupDraft {
		const members = new Set(group ? items.filter((item) => item.group === group).map((item) => item.id) : [])
		return { original: group, name: group ?? "", members }
	}

	const counts = useMemo(() => {
		const counts: Record<string, number> = {}
		for (const item of items) {
			counts[item.group] = (counts[item.group] ?? 0) + 1
		}
		return counts
	}, [items])

	const visibleItems = useMemo(() => {
		const terms = search.toLowerCase().split(" ").filter(Boolean)
		return items
			.filter((item) => terms.every((term) => `${item.name} ${item.group}`.toLowerCase().includes(term)))
			.sort((a, b) => a.name.localeCompare(b.name))
	}, [items, search])

	const name = draft.name.trim()
	const originalName = draft.original
	const canSave = !!name && draft.members.size > 0 && !saving

	const toggle = (id: string, checked: boolean) =>
		setDraft((current) => {
			const members = new Set(current.members)
			checked ? members.add(id) : members.delete(id)
			return { ...current, members }
		})

	const apply = async (changes: { id: string; group: string }[], done: () => void) => {
		setSaving(true)
		try {
			await saveChanges(changes)
			done()
		} catch (e) {
			toast({ variant: "destructive", title: t`Failed to save settings`, description: (e as Error).message })
		} finally {
			setSaving(false)
		}
	}

	const save = () => {
		const changes: { id: string; group: string }[] = []
		for (const item of items) {
			if (draft.members.has(item.id)) {
				if (item.group !== name) {
					changes.push({ id: item.id, group: name })
				}
			} else if (draft.original && item.group === draft.original) {
				changes.push({ id: item.id, group: "" })
			}
		}
		apply(changes, () => {
			toast({ title: t`Group saved` })
			setDraft(editGroup(name))
		})
	}

	const deleteGroup = () => {
		const original = draft.original
		if (!original) {
			return
		}
		const changes = items.filter((item) => item.group === original).map((item) => ({ id: item.id, group: "" }))
		apply(changes, () => {
			toast({ title: t`Group deleted`, description: texts.deleted() })
			setDraft(editGroup(groups.find((group) => group !== original) ?? null))
		})
	}

	return (
		<DialogContent className="max-w-3xl w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto">
			<DialogHeader>
				<DialogTitle>
					<Trans>Manage groups</Trans>
				</DialogTitle>
				<DialogDescription>{texts.description}</DialogDescription>
			</DialogHeader>

			<div className="grid sm:grid-cols-[16rem_minmax(0,1fr)] gap-4 min-w-0">
				<nav className="grid content-start gap-1">
					{groups.map((group) => (
						<button
							key={group}
							type="button"
							onClick={() => setDraft(editGroup(group))}
							className={cn(
								"flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-start hover:bg-accent/70",
								draft.original === group && "bg-accent text-accent-foreground font-medium"
							)}
						>
							<FolderIcon className="size-4 shrink-0 opacity-70" />
							<span className="min-w-0 break-words line-clamp-2" title={group}>
								{group}
							</span>
							<span className="ms-auto text-muted-foreground tabular-nums">{counts[group] ?? 0}</span>
						</button>
					))}
					<Button
						variant={draft.original === null ? "secondary" : "ghost"}
						size="sm"
						className="justify-start gap-2"
						onClick={() => setDraft(editGroup(null))}
					>
						<PlusIcon className="size-4" />
						<Trans>New group</Trans>
					</Button>
				</nav>

				<div className="grid content-start gap-3 min-w-0">
					<div className="grid gap-1.5">
						<Label htmlFor="group-name">
							<Trans>Name</Trans>
						</Label>
						<Input
							id="group-name"
							value={draft.name}
							maxLength={40}
							placeholder={t`Production, Customers, Lab…`}
							onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))}
						/>
					</div>
					<div className="grid gap-1.5">
						<div className="flex items-center gap-2">
							<Label>{texts.items}</Label>
							<span className="text-sm text-muted-foreground tabular-nums">({draft.members.size})</span>
							<Input
								placeholder={t`Filter...`}
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								className="ms-auto h-8 w-44"
							/>
						</div>
						<div className="grid gap-1 max-h-72 overflow-y-auto rounded-md border p-2">
							{visibleItems.map((system) => {
								const current = system.group
								return (
									<div key={system.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent/40">
										<Checkbox
											id={`group-member-${system.id}`}
											checked={draft.members.has(system.id)}
											onCheckedChange={(checked) => toggle(system.id, checked === true)}
										/>
										<label htmlFor={`group-member-${system.id}`} className="flex-1 min-w-0 truncate cursor-pointer">
											{system.name}
										</label>
										{current && current !== draft.original && (
											<span className="text-xs text-muted-foreground truncate max-w-40" title={current}>
												{current}
											</span>
										)}
									</div>
								)
							})}
						</div>
						<p className="text-xs text-muted-foreground">{texts.oneGroup}</p>
					</div>
				</div>
			</div>

			<DialogFooter className="gap-2 sm:justify-between">
				{draft.original ? (
					<Button variant="outline" className="gap-2 text-destructive" onClick={() => setConfirmDelete(true)} disabled={saving}>
						<Trash2Icon className="size-4" />
						<Trans>Delete group</Trans>
					</Button>
				) : (
					<span />
				)}
				<div className="flex gap-2">
					<Button variant="outline" onClick={onDone}>
						<Trans>Close</Trans>
					</Button>
					<Button className="gap-2" onClick={save} disabled={!canSave}>
						{saving && <LoaderCircleIcon className="size-4 animate-spin" />}
						<Trans>Save</Trans>
					</Button>
				</div>
			</DialogFooter>

			<AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle className="break-words">
							<Trans>Delete the group {originalName}?</Trans>
						</AlertDialogTitle>
						<AlertDialogDescription>{texts.kept}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>
							<Trans>Cancel</Trans>
						</AlertDialogCancel>
						<AlertDialogAction className={cn(buttonVariants({ variant: "destructive" }))} onClick={deleteGroup}>
							<Trans>Delete</Trans>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</DialogContent>
	)
}
