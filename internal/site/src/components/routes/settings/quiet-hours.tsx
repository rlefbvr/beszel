import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import {
	MoreHorizontalIcon,
	Trash2Icon,
	ServerIcon,
	ClockIcon,
	CalendarIcon,
	ActivityIcon,
	PenSquareIcon,
	MessageSquareTextIcon,
	NetworkIcon,
	GlobeIcon,
	BellOffIcon,
	ChevronDownIcon,
	RepeatIcon,
	PlusIcon,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog"
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
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
	quietHoursAlertKindLabel,
	quietHoursAlertKinds,
	quietHoursAppliesTo,
	quietHoursReasonLabel,
	quietHoursScopeText,
	quietHoursScoped,
	quietHoursSensorKinds,
	quietHoursReasons,
	quietHoursScheduleText,
	quietHoursState,
	quietHoursTypeLabel,
} from "@/lib/quiet-hours"
import { $sensors } from "@/lib/sensors"
import { $stateAlerts, refreshStateAlerts, stateRuleAlertKind } from "@/lib/state-alerts"
import { useNow } from "@/lib/time"
import { $allSystemsById, $systems } from "@/lib/stores"
import { cn, formatShortDate } from "@/lib/utils"
import type { QuietHoursRecord, StateAlertRecord, SystemRecord } from "@/types"
import { GuardedDialog } from "@/components/discard-guard"
import { MonthlyDays, WeekdayChips } from "@/components/quiet-hours-days"

const quietHoursTranslation = t`Quiet Hours`

/** Longest text shown in the fields of the dialog */
const maxShownLength = 60

/** A text cut to the longest shown in the fields of the dialog */
function clamp(text: string) {
	return text.length > maxShownLength ? `${text.slice(0, maxShownLength - 1)}…` : text
}

/** Value of the reason select for a custom reason */
const customReason = "other"

/**
 * Quiet hours windows with their state. With a systemId or a sensorId, only
 * the windows that apply to it (global or its own), and new windows target it.
 * compact leaves the title and description to the dialog showing the table.
 */
export function QuietHours({
	systemId,
	sensorId,
	compact = false,
}: {
	systemId?: string
	sensorId?: string
	compact?: boolean
}) {
	const records = useStore($quietHours)
	const systemsById = useStore($allSystemsById)
	const sensors = useStore($sensors)
	const [dialogOpen, setDialogOpen] = useState(false)
	const [editingRecord, setEditingRecord] = useState<QuietHoursRecord | null>(null)
	const { toast } = useToast()
	const systems = useStore($systems)
	const now = useNow()

	// global windows first, then by system name
	const data = useMemo(
		() =>
			Object.values(records)
				.filter((record) => quietHoursAppliesTo(record, { system: systemId, sensor: sensorId }))
				.sort(
					(a, b) =>
						Number(!!(a.system || a.sensor)) - Number(!!(b.system || b.sensor)) ||
						targetName(a).localeCompare(targetName(b)) ||
						a.start.localeCompare(b.start)
				),
		[records, systemId, sensorId, systemsById, sensors]
	)

	/** Name of the system or sensor of a window */
	function targetName(record: QuietHoursRecord) {
		if (record.sensor) {
			return sensors[record.sensor]?.name ?? record.sensor
		}
		return systemsById[record.system]?.name ?? record.system
	}

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

	const stateAlerts = useStore($stateAlerts)
	/** Alerts silenced by a window: all, or its alert types and rules */
	const scopeLabel = (record: QuietHoursRecord) =>
		quietHoursScoped(record) ? quietHoursScopeText(record, stateAlerts) : t`All alerts`

	/** When a window runs: its dates, or its days and hours for the recurring ones */
	const formatDateTime = (record: QuietHoursRecord) => quietHoursScheduleText(record, formatShortDate)

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
				<GuardedDialog open={dialogOpen} onOpenChange={setDialogOpen}>
					<DialogTrigger asChild>
						<Button variant="outline" className="h-10 shrink-0" onClick={() => setEditingRecord(null)}>
							{/* in the dialog of the quiet hours, its title already names them */}
							{compact ? <PlusIcon className="size-4" /> : <CalendarIcon className="size-4" />}
							<span className="ms-1">
								{compact ? <Trans>Add</Trans> : <Trans>Set up quiet hours</Trans>}
							</span>
						</Button>
					</DialogTrigger>
					<QuietHoursDialog
						editingRecord={editingRecord}
						systems={systems}
						defaultSystem={systemId}
						defaultSensor={sensorId}
						onClose={closeDialog}
						toast={toast}
					/>
				</GuardedDialog>
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
										<BellOffIcon className="size-4" />
										<Trans>Alerts</Trans>
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
										{record.system || record.sensor ? (
											<span className="flex items-center gap-1.5">
												{record.sensor ? (
													<NetworkIcon className="size-3.5 text-muted-foreground" />
												) : (
													<ServerIcon className="size-3.5 text-muted-foreground" />
												)}
												{targetName(record)}
											</span>
										) : (
											<span className="flex items-center gap-1.5">
												<GlobeIcon className="size-3.5 text-muted-foreground" />
												<Trans>All Systems</Trans>
											</span>
										)}
									</TableCell>
									<TableCell className="px-4 py-3">
										<span className="inline-flex items-center gap-1.5">
											{record.type === "one-time" ? (
												<CalendarIcon className="size-3.5 text-muted-foreground" />
											) : (
												<RepeatIcon className="size-3.5 text-muted-foreground" />
											)}
											{quietHoursTypeLabel(record.type)}
										</span>
									</TableCell>
									<TableCell className="px-4 py-3 whitespace-normal min-w-48 max-w-80">{formatDateTime(record)}</TableCell>
									<TableCell className="px-4 py-3 max-w-60 truncate" title={scopeLabel(record)}>
										{scopeLabel(record)}
									</TableCell>
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
	defaultSensor,
	onClose,
	toast,
}: {
	editingRecord: QuietHoursRecord | null
	systems: SystemRecord[]
	/** system selected for new windows */
	defaultSystem?: string
	/** network sensor of new windows: the dialog then targets it instead of a system */
	defaultSensor?: string
	onClose: () => void
	toast: ReturnType<typeof useToast>["toast"]
}) {
	const sensors = useStore($sensors)
	const stateAlerts = useStore($stateAlerts)
	useEffect(() => {
		refreshStateAlerts()
	}, [])
	const sensorList = Object.values(sensors).sort((a, b) => a.name.localeCompare(b.name))
	/** what the window silences: all, a system or a network sensor */
	const initialTarget = (system?: string, sensor?: string) => (sensor ? "sensor" : system ? "system" : "global")
	const [target, setTarget] = useState<"global" | "system" | "sensor">(
		editingRecord ? initialTarget(editingRecord.system, editingRecord.sensor) : initialTarget(defaultSystem, defaultSensor)
	)
	const [selectedSystem, setSelectedSystem] = useState(editingRecord?.system || "")
	const [selectedSensor, setSelectedSensor] = useState(editingRecord?.sensor || defaultSensor || "")
	const [windowType, setWindowType] = useState<QuietHoursRecord["type"]>(editingRecord?.type || "one-time")
	// days of the weekly and monthly windows, and weeks of the monthly windows on weekdays
	const [days, setDays] = useState<number[]>(editingRecord?.days ?? [])
	const [weeks, setWeeks] = useState<number[]>(editingRecord?.weeks ?? [])
	const [monthlyByWeekday, setMonthlyByWeekday] = useState(!!editingRecord?.weeks?.length)
	const [startDateTime, setStartDateTime] = useState("")
	const [endDateTime, setEndDateTime] = useState("")
	const [startTime, setStartTime] = useState("")
	const [endTime, setEndTime] = useState("")
	// preset reason key, customReason, or "" for none
	const [reasonChoice, setReasonChoice] = useState("")
	const [customReasonText, setCustomReasonText] = useState("")
	// alert types and state rules silenced; all the alerts when both are empty
	const [kinds, setKinds] = useState<string[]>([])
	const [rules, setRules] = useState<string[]>([])

	useEffect(() => {
		if (editingRecord) {
			setSelectedSystem(editingRecord.system || "")
			setSelectedSensor(editingRecord.sensor || "")
			setTarget(initialTarget(editingRecord.system, editingRecord.sensor))
			setWindowType(editingRecord.type)
			setDays(editingRecord.days ?? [])
			setWeeks(editingRecord.weeks ?? [])
			setMonthlyByWeekday(!!editingRecord.weeks?.length)
			if (editingRecord.type !== "one-time") {
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
			setKinds(editingRecord.alerts ?? [])
			setRules(editingRecord.rules ?? [])
		} else {
			// Reset form with default dates: today at 12pm and 1pm
			const today = new Date()
			const noon = new Date(today)
			noon.setHours(12, 0, 0, 0)
			const onePm = new Date(today)
			onePm.setHours(13, 0, 0, 0)

			setSelectedSystem(defaultSystem ?? "")
			setSelectedSensor(defaultSensor ?? "")
			setTarget(initialTarget(defaultSystem, defaultSensor))
			setWindowType("one-time")
			setDays([])
			setWeeks([])
			setMonthlyByWeekday(false)
			setStartDateTime(formatDateTimeLocal(noon))
			setEndDateTime(formatDateTimeLocal(onePm))
			setStartTime("12:00")
			setEndTime("13:00")
			setReasonChoice("")
			setCustomReasonText("")
			setKinds([])
			setRules([])
		}
	}, [editingRecord, defaultSystem, defaultSensor])

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		if ((windowType === "weekly" || windowType === "monthly") && !days.length) {
			toast({ variant: "destructive", title: t`Choose at least one day.` })
			return
		}
		if (windowType === "monthly" && monthlyByWeekday && !weeks.length) {
			toast({ variant: "destructive", title: t`Choose at least one week of the month.` })
			return
		}

		try {
			let startValue: string
			let endValue: string | undefined

			if (windowType !== "one-time") {
				// For recurring windows, convert local time to UTC
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
				system: target === "system" ? selectedSystem : "",
				sensor: target === "sensor" ? selectedSensor : "",
				type: windowType,
				start: startValue,
				end: endValue,
				// the days and hours are the ones of the user's timezone
				timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				days: windowType === "weekly" || windowType === "monthly" ? [...days].sort((a, b) => a - b) : [],
				weeks: windowType === "monthly" && monthlyByWeekday ? [...weeks].sort((a, b) => a - b) : [],
				reason: reasonChoice === customReason ? customReasonText.trim() : reasonChoice,
				alerts: kinds.filter((kind) =>
					(target === "sensor" ? quietHoursSensorKinds : quietHoursAlertKinds).includes(kind as never)
				),
				rules: target === "system" ? rules.filter((id) => stateAlerts[id]?.system === selectedSystem) : [],
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
		<DialogContent className="w-[calc(100vw-2rem)] max-w-4xl max-h-[calc(100dvh-2rem)] overflow-y-auto">
			<DialogHeader>
				<DialogTitle>
					{editingRecord ? (
						<Trans>Edit the quiet hours</Trans>
					) : (
						<Trans>Set up quiet hours</Trans>
					)}
				</DialogTitle>
				<DialogDescription>
					<Trans>Schedule quiet hours where notifications will not be sent.</Trans>
				</DialogDescription>
			</DialogHeader>
			<form onSubmit={handleSubmit} className="grid gap-4">
				<div className="grid gap-4 md:grid-cols-2 md:gap-6 items-start">
					{/* what the window silences, and why */}
					<div className="grid gap-4 content-start">
						<Tabs value={target} onValueChange={(value) => setTarget(value as typeof target)}>
							<TabsList className="grid w-full grid-cols-3">
								<TabsTrigger value="global" className="gap-1.5">
									<GlobeIcon className="size-3.5" />
									<Trans>Global</Trans>
								</TabsTrigger>
								<TabsTrigger value="system" className="gap-1.5">
									<ServerIcon className="size-3.5" />
									<Trans>System</Trans>
								</TabsTrigger>
								<TabsTrigger value="sensor" className="gap-1.5">
									<NetworkIcon className="size-3.5" />
									<Trans>Sensor</Trans>
								</TabsTrigger>
							</TabsList>

							<TabsContent value="sensor" className="mt-4">
								<div className="grid gap-2">
									<Label htmlFor="sensor">
										<Trans>Sensor</Trans>
									</Label>
									<Select value={selectedSensor} onValueChange={setSelectedSensor}>
										<SelectTrigger id="sensor">
											<SelectValue placeholder={t`Select ${{ foo: t`Sensor`.toLocaleLowerCase() }}`} />
										</SelectTrigger>
										<SelectContent>
											{sensorList.map((sensor) => (
												<SelectItem key={sensor.id} value={sensor.id}>
													{clamp(sensor.name)}
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
										value={selectedSensor}
										onChange={() => {}}
										required={target === "sensor"}
									/>
								</div>
							</TabsContent>
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
													{clamp(system.name)}
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
										required={target === "system"}
									/>
								</div>
							</TabsContent>
						</Tabs>

						<QuietHoursScopePicker
							kindList={target === "sensor" ? quietHoursSensorKinds : quietHoursAlertKinds}
							kinds={kinds}
							rules={rules}
							systemRules={
								target === "system"
									? Object.values(stateAlerts).filter((rule) => rule.system === selectedSystem)
									: []
							}
							onChange={(nextKinds, nextRules) => {
								setKinds(nextKinds)
								setRules(nextRules)
							}}
						/>

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

					</div>
					{/* when it runs */}
					<div className="grid gap-4 content-start md:border-s md:ps-6">
						<div className="grid gap-2">
							<Label htmlFor="type">
								<Trans>Type</Trans>
							</Label>
							<Select
								value={windowType}
								onValueChange={(value: QuietHoursRecord["type"]) => {
									setWindowType(value)
									// the days of the week and of the month don't mean the same
									setDays([])
									setWeeks([])
								}}
							>
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
									<SelectItem value="weekly">
										<Trans>Weekly, on some days</Trans>
									</SelectItem>
									<SelectItem value="monthly">
										<Trans>Monthly</Trans>
									</SelectItem>
								</SelectContent>
							</Select>
						</div>

						{windowType === "weekly" && <WeekdayChips selected={days} onChange={setDays} />}
						{windowType === "monthly" && (
							<MonthlyDays
								byWeekday={monthlyByWeekday}
								days={days}
								weeks={weeks}
								onChange={(byWeekday, nextDays, nextWeeks) => {
									setMonthlyByWeekday(byWeekday)
									setDays(nextDays)
									setWeeks(nextWeeks)
								}}
							/>
						)}

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

					</div>
				</div>

				<DialogFooter>
					<Button type="button" variant="outline" onClick={onClose}>
						<Trans>Cancel</Trans>
					</Button>
					<Button type="submit" className="gap-2">
						{editingRecord ? (
							<Trans>Update</Trans>
						) : (
							<>
								<CalendarIcon className="size-4" />
								<Trans>Set up</Trans>
							</>
						)}
					</Button>
				</DialogFooter>
			</form>
		</DialogContent>
	)
}

/** Label of a state rule: its kind and targets, such as "Service state: nginx, sshd" */
function ruleLabel(rule: StateAlertRecord) {
	const kind = quietHoursAlertKindLabel(stateRuleAlertKind(rule.kind))
	return `${kind}: ${rule.targets}`
}

/** Choice of the alerts silenced by a window: all, or some alert types and state rules of the system */
function QuietHoursScopePicker({
	kindList,
	kinds,
	rules,
	systemRules,
	onChange,
}: {
	/** alert types offered: of the systems or of the sensors */
	kindList: readonly string[]
	kinds: string[]
	rules: string[]
	systemRules: StateAlertRecord[]
	onChange: (kinds: string[], rules: string[]) => void
}) {
	const shownRules = rules.filter((id) => systemRules.some((rule) => rule.id === id))
	const shownKinds = kinds.filter((kind) => kindList.includes(kind))
	const count = shownKinds.length + shownRules.length
	const toggle = (list: string[], value: string, checked: boolean) =>
		checked ? [...list.filter((item) => item !== value), value] : list.filter((item) => item !== value)
	return (
		<div className="grid gap-2">
			<Label htmlFor="quiet-alerts">
				<Trans>Silenced alerts</Trans>
			</Label>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button id="quiet-alerts" type="button" variant="outline" className="justify-between font-normal">
						<span className="whitespace-nowrap">
							{count === 0 ? (
								<Trans>All alerts</Trans>
							) : (
								clamp(
									[
										...shownKinds.map(quietHoursAlertKindLabel),
										...systemRules.filter((rule) => shownRules.includes(rule.id)).map(ruleLabel),
									].join(", ")
								)
							)}
						</span>
						<ChevronDownIcon className="size-4 opacity-50 shrink-0" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align="start"
					className="w-[var(--radix-dropdown-menu-trigger-width)] max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto"
				>
					<DropdownMenuCheckboxItem
						checked={count === 0}
						onSelect={(e) => e.preventDefault()}
						onCheckedChange={() => onChange([], [])}
					>
						<Trans>All alerts</Trans>
					</DropdownMenuCheckboxItem>
					<DropdownMenuSeparator />
					<DropdownMenuLabel className="text-xs text-muted-foreground">
						<Trans>Alert types</Trans>
					</DropdownMenuLabel>
					{kindList.map((kind) => (
						<DropdownMenuCheckboxItem
							key={kind}
							checked={shownKinds.includes(kind)}
							onSelect={(e) => e.preventDefault()}
							onCheckedChange={(checked) => onChange(toggle(shownKinds, kind, checked === true), shownRules)}
						>
							{quietHoursAlertKindLabel(kind)}
						</DropdownMenuCheckboxItem>
					))}
					{systemRules.length > 0 && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuLabel className="text-xs text-muted-foreground">
								<Trans>Rules of this system</Trans>
							</DropdownMenuLabel>
							{systemRules.map((rule) => (
								<DropdownMenuCheckboxItem
									key={rule.id}
									checked={shownRules.includes(rule.id)}
									onSelect={(e) => e.preventDefault()}
									onCheckedChange={(checked) => onChange(shownKinds, toggle(shownRules, rule.id, checked === true))}
								>
									<span className="whitespace-nowrap">{clamp(ruleLabel(rule))}</span>
								</DropdownMenuCheckboxItem>
							))}
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	)
}
