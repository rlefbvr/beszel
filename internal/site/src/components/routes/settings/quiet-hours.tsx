import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import {
	MoreHorizontalIcon,
	PlusIcon,
	Trash2Icon,
	ServerIcon,
	ClockIcon,
	CalendarIcon,
	ActivityIcon,
	PenSquareIcon,
	MessageSquareTextIcon,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/components/ui/use-toast"
import { pb } from "@/lib/api"
import {
	$quietHours,
	isPresetReason,
	type QuietHoursState,
	quietHoursReasonLabel,
	quietHoursReasons,
	quietHoursState,
} from "@/lib/quiet-hours"
import { useNow } from "@/lib/time"
import { $allSystemsById, $systems } from "@/lib/stores"
import { cn, formatShortDate } from "@/lib/utils"
import type { QuietHoursRecord, SystemRecord } from "@/types"

const quietHoursTranslation = t`Quiet Hours`

/** Value of the reason select for a custom reason */
const customReason = "other"

/**
 * Quiet hours windows with their state. With a systemId, only the windows
 * that apply to that system (global or its own), and new windows target it.
 * compact leaves the title and description to the dialog showing the table.
 */
export function QuietHours({ systemId, compact = false }: { systemId?: string; compact?: boolean }) {
	const records = useStore($quietHours)
	const systemsById = useStore($allSystemsById)
	const [dialogOpen, setDialogOpen] = useState(false)
	const [editingRecord, setEditingRecord] = useState<QuietHoursRecord | null>(null)
	const { toast } = useToast()
	const systems = useStore($systems)
	const now = useNow()

	// global windows first, then by system name
	const data = useMemo(
		() =>
			Object.values(records)
				.filter((record) => !systemId || !record.system || record.system === systemId)
				.sort(
					(a, b) =>
						Number(!!a.system) - Number(!!b.system) ||
						(systemsById[a.system]?.name ?? "").localeCompare(systemsById[b.system]?.name ?? "") ||
						a.start.localeCompare(b.start)
				),
		[records, systemId, systemsById]
	)

	const handleDelete = async (id: string) => {
		try {
			await pb.collection("quiet_hours").delete(id)
		} catch (e: unknown) {
			toast({
				variant: "destructive",
				title: t`Error`,
				description: (e as Error).message || "Failed to delete quiet hours.",
			})
		}
	}

	const openEditDialog = (record: QuietHoursRecord) => {
		setEditingRecord(record)
		setDialogOpen(true)
	}

	const closeDialog = () => {
		setDialogOpen(false)
		setEditingRecord(null)
	}

	const formatDateTime = (record: QuietHoursRecord) => {
		if (record.type === "daily") {
			// For daily windows, show only time
			const startTime = new Date(record.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
			const endTime = new Date(record.end).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
			return `${startTime} - ${endTime}`
		}
		// For one-time windows, show full date and time
		const start = formatShortDate(record.start)
		const end = formatShortDate(record.end)
		return `${start} - ${end}`
	}

	return (
		<>
			<div className={cn("grid grid-cols-1 sm:flex items-center justify-between gap-4 mb-3", compact && "sm:justify-end")}>
				{!compact && (
					<div>
						<h3 className="mb-1 font-medium text-lg">{quietHoursTranslation}</h3>
						<p className="text-sm text-muted-foreground leading-relaxed">
							<Trans>
								Schedule quiet hours where notifications will not be sent, such as during maintenance periods.
							</Trans>
						</p>
					</div>
				)}
				<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
					<DialogTrigger asChild>
						<Button variant="outline" className="h-10 shrink-0" onClick={() => setEditingRecord(null)}>
							<PlusIcon className="size-4" />
							<span className="ms-1">
								<Trans>Add {{ foo: quietHoursTranslation }}</Trans>
							</span>
						</Button>
					</DialogTrigger>
					<QuietHoursDialog
						editingRecord={editingRecord}
						systems={systems}
						defaultSystem={systemId}
						onClose={closeDialog}
						toast={toast}
					/>
				</Dialog>
			</div>
			{data.length > 0 && (
				<div className="rounded-md border overflow-x-auto whitespace-nowrap">
					<Table>
						<TableHeader>
							<TableRow className="border-border/50">
								<TableHead className="px-4">
									<span className="flex items-center gap-2">
										<ServerIcon className="size-4" />
										<Trans>System</Trans>
									</span>
								</TableHead>
								<TableHead className="px-4">
									<span className="flex items-center gap-2">
										<ClockIcon className="size-4" />
										<Trans>Type</Trans>
									</span>
								</TableHead>
								<TableHead className="px-4">
									<span className="flex items-center gap-2">
										<CalendarIcon className="size-4" />
										<Trans>Schedule</Trans>
									</span>
								</TableHead>
								<TableHead className="px-4">
									<span className="flex items-center gap-2">
										<MessageSquareTextIcon className="size-4" />
										<Trans>Reason</Trans>
									</span>
								</TableHead>
								<TableHead className="px-4">
									<span className="flex items-center gap-2">
										<ActivityIcon className="size-4" />
										<Trans>State</Trans>
									</span>
								</TableHead>
								<TableHead className="px-4 text-right sr-only">
									<Trans>Actions</Trans>
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{data.map((record) => (
								<TableRow key={record.id}>
									<TableCell className="px-4 py-3">
										{record.system ? systemsById[record.system]?.name || record.system : <Trans>All Systems</Trans>}
									</TableCell>
									<TableCell className="px-4 py-3">
										{record.type === "daily" ? <Trans>Daily</Trans> : <Trans>One-time</Trans>}
									</TableCell>
									<TableCell className="px-4 py-3">{formatDateTime(record)}</TableCell>
									<TableCell className="px-4 py-3 max-w-60 truncate" title={quietHoursReasonLabel(record.reason)}>
										{quietHoursReasonLabel(record.reason) || <span className="text-muted-foreground">-</span>}
									</TableCell>
									<TableCell className="px-4 py-3">
										<QuietHoursStateBadge state={quietHoursState(record, now)} />
									</TableCell>
									<TableCell className="px-4 py-3 text-right">
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button variant="ghost" size="icon" className="size-8">
													<span className="sr-only">
														<Trans>Open menu</Trans>
													</span>
													<MoreHorizontalIcon className="size-4" />
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<DropdownMenuItem onClick={() => openEditDialog(record)}>
													<PenSquareIcon className="me-2.5 size-4" />
													<Trans>Edit</Trans>
												</DropdownMenuItem>
												<DropdownMenuSeparator />
												<DropdownMenuItem onClick={() => handleDelete(record.id)}>
													<Trash2Icon className="me-2.5 size-4" />
													<Trans>Delete</Trans>
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}
		</>
	)
}

/** Colored state of a quiet hours window */
export function QuietHoursStateBadge({ state }: { state: QuietHoursState }) {
	const stateConfig = {
		active: { label: <Trans>Active</Trans>, variant: "success" as const },
		past: { label: <Trans>Past</Trans>, variant: "danger" as const },
		inactive: { label: <Trans>Inactive</Trans>, variant: "default" as const },
	}
	const config = stateConfig[state]
	return <Badge variant={config.variant}>{config.label}</Badge>
}

// Helper function to format Date as datetime-local string (YYYY-MM-DDTHH:mm) in local time
function formatDateTimeLocal(date: Date): string {
	const year = date.getFullYear()
	const month = String(date.getMonth() + 1).padStart(2, "0")
	const day = String(date.getDate()).padStart(2, "0")
	const hours = String(date.getHours()).padStart(2, "0")
	const minutes = String(date.getMinutes()).padStart(2, "0")
	return `${year}-${month}-${day}T${hours}:${minutes}`
}

function QuietHoursDialog({
	editingRecord,
	systems,
	defaultSystem,
	onClose,
	toast,
}: {
	editingRecord: QuietHoursRecord | null
	systems: SystemRecord[]
	/** system selected for new windows */
	defaultSystem?: string
	onClose: () => void
	toast: ReturnType<typeof useToast>["toast"]
}) {
	const [selectedSystem, setSelectedSystem] = useState(editingRecord?.system || "")
	const [isGlobal, setIsGlobal] = useState(!editingRecord?.system)
	const [windowType, setWindowType] = useState<"one-time" | "daily">(editingRecord?.type || "one-time")
	const [startDateTime, setStartDateTime] = useState("")
	const [endDateTime, setEndDateTime] = useState("")
	const [startTime, setStartTime] = useState("")
	const [endTime, setEndTime] = useState("")
	// preset reason key, customReason, or "" for none
	const [reasonChoice, setReasonChoice] = useState("")
	const [customReasonText, setCustomReasonText] = useState("")

	useEffect(() => {
		if (editingRecord) {
			setSelectedSystem(editingRecord.system || "")
			setIsGlobal(!editingRecord.system)
			setWindowType(editingRecord.type)
			if (editingRecord.type === "daily") {
				// Extract time from datetime
				const start = new Date(editingRecord.start)
				const end = editingRecord.end ? new Date(editingRecord.end) : null
				setStartTime(start.toTimeString().slice(0, 5))
				setEndTime(end ? end.toTimeString().slice(0, 5) : "")
			} else {
				// For one-time, format as datetime-local (local time, not UTC)
				const startDate = new Date(editingRecord.start)
				const endDate = editingRecord.end ? new Date(editingRecord.end) : null

				setStartDateTime(formatDateTimeLocal(startDate))
				setEndDateTime(endDate ? formatDateTimeLocal(endDate) : "")
			}
			const reason = editingRecord.reason ?? ""
			setReasonChoice(isPresetReason(reason) ? reason : reason ? customReason : "")
			setCustomReasonText(isPresetReason(reason) ? "" : reason)
		} else {
			// Reset form with default dates: today at 12pm and 1pm
			const today = new Date()
			const noon = new Date(today)
			noon.setHours(12, 0, 0, 0)
			const onePm = new Date(today)
			onePm.setHours(13, 0, 0, 0)

			setSelectedSystem(defaultSystem ?? "")
			setIsGlobal(!defaultSystem)
			setWindowType("one-time")
			setStartDateTime(formatDateTimeLocal(noon))
			setEndDateTime(formatDateTimeLocal(onePm))
			setStartTime("12:00")
			setEndTime("13:00")
			setReasonChoice("")
			setCustomReasonText("")
		}
	}, [editingRecord, defaultSystem])

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()

		try {
			let startValue: string
			let endValue: string | undefined

			if (windowType === "daily") {
				// For daily windows, convert local time to UTC
				// Use today's date so the current DST offset is applied (not a fixed historical date)
				const today = new Date().toISOString().split("T")[0]
				const startDate = new Date(`${today}T${startTime}:00`)
				startValue = startDate.toISOString()

				if (endTime) {
					const endDate = new Date(`${today}T${endTime}:00`)
					endValue = endDate.toISOString()
				}
			} else {
				// For one-time windows, use the datetime values
				startValue = new Date(startDateTime).toISOString()
				endValue = endDateTime ? new Date(endDateTime).toISOString() : undefined
			}

			const data = {
				user: pb.authStore.record?.id,
				system: isGlobal ? "" : selectedSystem,
				type: windowType,
				start: startValue,
				end: endValue,
				reason: reasonChoice === customReason ? customReasonText.trim() : reasonChoice,
			}

			if (editingRecord) {
				await pb.collection("quiet_hours").update(editingRecord.id, data)
			} else {
				await pb.collection("quiet_hours").create(data)
			}

			onClose()
		} catch (e) {
			toast({
				variant: "destructive",
				title: t`Error`,
				description: t`Failed to save settings`,
			})
		}
	}

	return (
		<DialogContent>
			<DialogHeader>
				<DialogTitle>
					{editingRecord ? (
						<Trans>Edit {{ foo: quietHoursTranslation }}</Trans>
					) : (
						<Trans>Add {{ foo: quietHoursTranslation }}</Trans>
					)}
				</DialogTitle>
				<DialogDescription>
					<Trans>Schedule quiet hours where notifications will not be sent.</Trans>
				</DialogDescription>
			</DialogHeader>
			<form onSubmit={handleSubmit} className="space-y-4">
				<Tabs value={isGlobal ? "global" : "system"} onValueChange={(value) => setIsGlobal(value === "global")}>
					<TabsList className="grid w-full grid-cols-2">
						<TabsTrigger value="global">
							<Trans>Global</Trans>
						</TabsTrigger>
						<TabsTrigger value="system">
							<Trans>System</Trans>
						</TabsTrigger>
					</TabsList>

					<TabsContent value="system" className="mt-4 space-y-4">
						<div className="grid gap-2">
							<Label htmlFor="system">
								<Trans>System</Trans>
							</Label>
							<Select value={selectedSystem} onValueChange={setSelectedSystem}>
								<SelectTrigger id="system">
									<SelectValue placeholder={t`Select ${{ foo: t`System`.toLocaleLowerCase() }}`} />
								</SelectTrigger>
								<SelectContent>
									{systems.map((system) => (
										<SelectItem key={system.id} value={system.id}>
											{system.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{/* Hidden input for native form validation */}
							<input
								className="sr-only"
								type="text"
								tabIndex={-1}
								autoComplete="off"
								value={selectedSystem}
								onChange={() => {}}
								required={!isGlobal}
							/>
						</div>
					</TabsContent>
				</Tabs>

				<div className="grid gap-2">
					<Label htmlFor="type">
						<Trans>Type</Trans>
					</Label>
					<Select value={windowType} onValueChange={(value: "one-time" | "daily") => setWindowType(value)}>
						<SelectTrigger id="type">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="one-time">
								<Trans>One-time</Trans>
							</SelectItem>
							<SelectItem value="daily">
								<Trans>Daily</Trans>
							</SelectItem>
						</SelectContent>
					</Select>
				</div>

				{windowType === "one-time" ? (
					<>
						<div className="grid gap-2">
							<Label htmlFor="start-datetime">
								<Trans>Start Time</Trans>
							</Label>
							<Input
								id="start-datetime"
								type="datetime-local"
								value={startDateTime}
								onChange={(e) => setStartDateTime(e.target.value)}
								min={formatDateTimeLocal(new Date(new Date().setHours(0, 0, 0, 0)))}
								required
								className="tabular-nums tracking-tighter"
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="end-datetime">
								<Trans>End Time</Trans>
							</Label>
							<Input
								id="end-datetime"
								type="datetime-local"
								value={endDateTime}
								onChange={(e) => setEndDateTime(e.target.value)}
								min={startDateTime || formatDateTimeLocal(new Date())}
								required
								className="tabular-nums tracking-tighter"
							/>
						</div>
					</>
				) : (
					<div className="grid gap-2 grid-cols-2">
						<div>
							<Label htmlFor="start-time">
								<Trans>Start Time</Trans>
							</Label>
							<Input
								className="tabular-nums tracking-tighter"
								id="start-time"
								type="time"
								value={startTime}
								onChange={(e) => setStartTime(e.target.value)}
								required
							/>
						</div>
						<div>
							<Label htmlFor="end-time">
								<Trans>End Time</Trans>
							</Label>
							<Input
								className="tabular-nums tracking-tighter"
								id="end-time"
								type="time"
								value={endTime}
								onChange={(e) => setEndTime(e.target.value)}
								required
							/>
						</div>
					</div>
				)}

				<div className="grid gap-2">
					<Label htmlFor="reason">
						<Trans>Reason</Trans>
					</Label>
					<Select value={reasonChoice || "none"} onValueChange={(value) => setReasonChoice(value === "none" ? "" : value)}>
						<SelectTrigger id="reason">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="none">
								<Trans>None</Trans>
							</SelectItem>
							{Object.entries(quietHoursReasons).map(([key, label]) => (
								<SelectItem key={key} value={key}>
									{label()}
								</SelectItem>
							))}
							<SelectItem value={customReason}>
								<Trans>Other</Trans>
							</SelectItem>
						</SelectContent>
					</Select>
					{reasonChoice === customReason && (
						<Input
							aria-label={t`Reason`}
							placeholder={t`Describe the reason`}
							value={customReasonText}
							onChange={(e) => setCustomReasonText(e.target.value)}
							maxLength={200}
							required
						/>
					)}
				</div>

				<DialogFooter>
					<Button type="button" variant="outline" onClick={onClose}>
						<Trans>Cancel</Trans>
					</Button>
					<Button type="submit">{editingRecord ? <Trans>Update</Trans> : <Trans>Create</Trans>}</Button>
				</DialogFooter>
			</form>
		</DialogContent>
	)
}
