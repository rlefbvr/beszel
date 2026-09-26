import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { getPagePath } from "@nanostores/router"
import { DialogDescription } from "@radix-ui/react-dialog"
import {
	AlertOctagonIcon,
	BookIcon,
	ContainerIcon,
	DatabaseBackupIcon,
	FingerprintIcon,
	HardDriveIcon,
	LogsIcon,
	MailIcon,
	NetworkIcon,
	RefreshCcwDotIcon,
	Server,
	ServerCogIcon,
	ServerIcon,
	SettingsIcon,
	UsersIcon,
} from "lucide-react"
import { memo, type ReactNode, useEffect, useMemo, useState } from "react"
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
	CommandShortcut,
} from "@/components/ui/command"
import { useStore } from "@nanostores/react"
import { isAdmin, pb } from "@/lib/api"
import { $openRequest, type RecentItem } from "@/lib/recent"
import { $checksBySensor, $sensors } from "@/lib/sensors"
import { $allSystemsById, $systems, $userSettings } from "@/lib/stores"
import type { ContainerRecord, SystemdRecord } from "@/types"
import { getHostDisplayValue, listen } from "@/lib/utils"
import { $router, basePath, navigate, prependBasePath } from "./router"

export default memo(function CommandPalette({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) {
	useEffect(() => {
		const down = (e: KeyboardEvent) => {
			if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault()
				setOpen(!open)
			}
		}
		return listen(document, "keydown", down)
	}, [open, setOpen])
	const [search, setSearch] = useState("")
	// a new opening starts with an empty search
	useEffect(() => {
		if (!open) {
			setSearch("")
		}
	}, [open])

	return useMemo(() => {
		const SettingsShortcut = (
			<CommandShortcut>
				<Trans>Settings</Trans>
			</CommandShortcut>
		)
		const AdminShortcut = (
			<CommandShortcut>
				<Trans>Admin</Trans>
			</CommandShortcut>
		)
		return (
			<CommandDialog open={open} onOpenChange={setOpen}>
				<DialogDescription className="sr-only">Command palette</DialogDescription>
				<CommandInput
					placeholder={t`Search for systems, sensors, containers, services or settings...`}
					value={search}
					onValueChange={setSearch}
				/>
				<CommandList>
					{search.trim() ? (
						<SearchResults query={search.trim()} onDone={() => setOpen(false)} />
					) : (
						<RecentItems onDone={() => setOpen(false)} />
					)}
					<CommandGroup heading={t`Pages / Settings`}>
						<CommandItem
							onSelect={() => {
								navigate(getPagePath($router, "monitors"))
								setOpen(false)
							}}
						>
							<NetworkIcon className="me-2 size-4" />
							<span>
								<Trans>Network Monitors</Trans>
							</span>
							<CommandShortcut>
								<Trans>Page</Trans>
							</CommandShortcut>
						</CommandItem>
						<CommandItem
							keywords={["home"]}
							onSelect={() => {
								navigate(basePath)
								setOpen(false)
							}}
						>
							<ServerIcon className="me-2 size-4" />
							<span>
								<Trans>All Systems</Trans>
							</span>
							<CommandShortcut>
								<Trans>Page</Trans>
							</CommandShortcut>
						</CommandItem>
						<CommandItem
							onSelect={() => {
								navigate(getPagePath($router, "containers"))
								setOpen(false)
							}}
						>
							<ContainerIcon className="me-2 size-4" />
							<span>
								<Trans>All Containers</Trans>
							</span>
							<CommandShortcut>
								<Trans>Page</Trans>
							</CommandShortcut>
						</CommandItem>
						<CommandItem
							keywords={["systemd", "windows"]}
							onSelect={() => {
								navigate(getPagePath($router, "services"))
								setOpen(false)
							}}
						>
							<ServerCogIcon className="me-2 size-4" />
							<span>
								<Trans>All Services</Trans>
							</span>
							<CommandShortcut>
								<Trans>Page</Trans>
							</CommandShortcut>
						</CommandItem>
						<CommandItem
							keywords={["boot", "restart", "shutdown"]}
							onSelect={() => {
								navigate(getPagePath($router, "reboots"))
								setOpen(false)
							}}
						>
							<RefreshCcwDotIcon className="me-2 size-4" />
							<span>
								<Trans>All Reboots</Trans>
							</span>
							<CommandShortcut>
								<Trans>Page</Trans>
							</CommandShortcut>
						</CommandItem>
						<CommandItem
							onSelect={() => {
								navigate(getPagePath($router, "smart"))
								setOpen(false)
							}}
						>
							<HardDriveIcon className="me-2 size-4" />
							<span>S.M.A.R.T.</span>
							<CommandShortcut>
								<Trans>Page</Trans>
							</CommandShortcut>
						</CommandItem>
						<CommandItem
							onSelect={() => {
								navigate(getPagePath($router, "settings", { name: "general" }))
								setOpen(false)
							}}
						>
							<SettingsIcon className="me-2 size-4" />
							<span>
								<Trans>Settings</Trans>
							</span>
							{SettingsShortcut}
						</CommandItem>
						<CommandItem
							keywords={["alerts"]}
							onSelect={() => {
								navigate(getPagePath($router, "settings", { name: "notifications" }))
								setOpen(false)
							}}
						>
							<MailIcon className="me-2 size-4" />
							<span>
								<Trans>Notifications</Trans>
							</span>
							{SettingsShortcut}
						</CommandItem>
						<CommandItem
							keywords={[t`Universal token`]}
							onSelect={() => {
								navigate(getPagePath($router, "settings", { name: "tokens" }))
								setOpen(false)
							}}
						>
							<FingerprintIcon className="me-2 size-4" />
							<span>
								<Trans>Tokens & Fingerprints</Trans>
							</span>
							{SettingsShortcut}
						</CommandItem>
						<CommandItem
							onSelect={() => {
								navigate(getPagePath($router, "settings", { name: "alert-history" }))
								setOpen(false)
							}}
						>
							<AlertOctagonIcon className="me-2 size-4" />
							<span>
								<Trans>Alert History</Trans>
							</span>
							{SettingsShortcut}
						</CommandItem>
						<CommandItem
							keywords={["help", "oauth", "oidc"]}
							onSelect={() => {
								window.location.href = "https://beszel.dev/guide/what-is-beszel"
							}}
						>
							<BookIcon className="me-2 size-4" />
							<span>
								<Trans>Documentation</Trans>
							</span>
							<CommandShortcut>beszel.dev</CommandShortcut>
						</CommandItem>
					</CommandGroup>
					{isAdmin() && (
						<>
							<CommandSeparator className="mb-1.5" />
							<CommandGroup heading={t`Admin`}>
								<CommandItem
									keywords={["pocketbase"]}
									onSelect={() => {
										setOpen(false)
										window.open(prependBasePath("/_/"), "_blank")
									}}
								>
									<UsersIcon className="me-2 size-4" />
									<span>
										<Trans>Users</Trans>
									</span>
									{AdminShortcut}
								</CommandItem>
								<CommandItem
									onSelect={() => {
										setOpen(false)
										window.open(prependBasePath("/_/#/logs"), "_blank")
									}}
								>
									<LogsIcon className="me-2 size-4" />
									<span>
										<Trans>Logs</Trans>
									</span>
									{AdminShortcut}
								</CommandItem>
								<CommandItem
									onSelect={() => {
										setOpen(false)
										window.open(prependBasePath("/_/#/settings/backups"), "_blank")
									}}
								>
									<DatabaseBackupIcon className="me-2 size-4" />
									<span>
										<Trans>Backups</Trans>
									</span>
									{AdminShortcut}
								</CommandItem>
								<CommandItem
									keywords={["email"]}
									onSelect={() => {
										setOpen(false)
										window.open(prependBasePath("/_/#/settings/mail"), "_blank")
									}}
								>
									<MailIcon className="me-2 size-4" />
									<span>
										<Trans>SMTP settings</Trans>
									</span>
									{AdminShortcut}
								</CommandItem>
							</CommandGroup>
						</>
					)}
					<CommandEmpty>
						<Trans>No results found.</Trans>
					</CommandEmpty>
				</CommandList>
			</CommandDialog>
		)
	}, [open, search])
})

/** Opens an object: the page of a system or sensor, or the page of the containers or services with its details */
function openObject(item: Pick<RecentItem, "kind" | "id">) {
	switch (item.kind) {
		case "system":
			navigate(getPagePath($router, "system", { id: item.id }))
			break
		case "sensor":
			navigate(getPagePath($router, "sensor", { id: item.id }))
			break
		case "container":
			$openRequest.set({ kind: "container", id: item.id })
			navigate(getPagePath($router, "containers"))
			break
		case "service":
			$openRequest.set({ kind: "service", id: item.id })
			navigate(getPagePath($router, "services"))
			break
	}
}

const kindIcons = { system: Server, sensor: NetworkIcon, container: ContainerIcon, service: ServerCogIcon }

/** An object of the palette: its icon, name and where it is */
function ObjectItem({
	item,
	value,
	keywords,
	detail,
	onDone,
}: {
	item: Pick<RecentItem, "kind" | "id" | "name">
	/** unique text of the item, searched with the keywords */
	value: string
	keywords?: string[]
	detail?: ReactNode
	onDone: () => void
}) {
	const Icon = kindIcons[item.kind]
	return (
		<CommandItem
			value={value}
			keywords={keywords}
			onSelect={() => {
				openObject(item)
				onDone()
			}}
		>
			<Icon className="me-2 size-4" />
			<span className="max-w-72 truncate">{item.name}</span>
			{detail && <CommandShortcut className="max-w-48 truncate">{detail}</CommandShortcut>}
		</CommandItem>
	)
}

/** The objects opened recently, shown before any search */
function RecentItems({ onDone }: { onDone: () => void }) {
	const recent = useStore($userSettings).recent ?? []
	const systems = useStore($allSystemsById)
	const sensors = useStore($sensors)
	if (!recent.length) {
		return null
	}
	return (
		<>
			<CommandGroup heading={t`Recently opened`}>
				{recent.map((item) => {
					// current names when known
					const name =
						(item.kind === "system" ? systems[item.id]?.name : item.kind === "sensor" ? sensors[item.id]?.name : "") ||
						item.name ||
						item.id
					const detail =
						item.kind === "system"
							? systems[item.id] && getHostDisplayValue(systems[item.id])
							: item.kind === "sensor"
								? sensors[item.id]?.host
								: systems[item.system ?? ""]?.name
					return (
						<ObjectItem
							key={`${item.kind}${item.id}`}
							item={{ ...item, name }}
							value={`recent ${item.kind} ${item.id} ${name}`}
							detail={detail}
							onDone={onDone}
						/>
					)
				})}
			</CommandGroup>
			<CommandSeparator className="mb-1.5" />
		</>
	)
}

/** Systems, sensors, containers and services matching the search; containers and services are searched on the hub */
function SearchResults({ query, onDone }: { query: string; onDone: () => void }) {
	const systems = useStore($systems)
	const systemsById = useStore($allSystemsById)
	const sensors = useStore($sensors)
	const checksBySensor = useStore($checksBySensor)
	const [remote, setRemote] = useState<{ containers: ContainerRecord[]; services: SystemdRecord[] }>({
		containers: [],
		services: [],
	})

	useEffect(() => {
		let cancelled = false
		const timer = setTimeout(async () => {
			const options = {
				filter: pb.filter("name ~ {:query}", { query }),
				fields: "id,name,system",
				sort: "name",
			}
			try {
				const [containers, services] = await Promise.all([
					pb.collection<ContainerRecord>("containers").getList(1, 10, { ...options, requestKey: "palette-containers" }),
					pb
						.collection<SystemdRecord>("systemd_services")
						.getList(1, 10, { ...options, requestKey: "palette-services" }),
				])
				if (!cancelled) {
					setRemote({ containers: containers.items, services: services.items })
				}
			} catch {
				// canceled by a newer search
			}
		}, 200)
		return () => {
			cancelled = true
			clearTimeout(timer)
		}
	}, [query])

	const sensorList = Object.values(sensors).sort((a, b) => a.name.localeCompare(b.name))
	return (
		<>
			{systems.length > 0 && (
				<CommandGroup heading={t`Systems`}>
					{systems.map((system) => (
						<ObjectItem
							key={system.id}
							item={{ kind: "system", id: system.id, name: system.name }}
							value={`system ${system.id} ${system.name}`}
							keywords={[system.host]}
							detail={getHostDisplayValue(system)}
							onDone={onDone}
						/>
					))}
				</CommandGroup>
			)}
			{sensorList.length > 0 && (
				<CommandGroup heading={t`Network sensors`}>
					{sensorList.map((sensor) => (
						<ObjectItem
							key={sensor.id}
							item={{ kind: "sensor", id: sensor.id, name: sensor.name }}
							value={`sensor ${sensor.id} ${sensor.name}`}
							keywords={[
								sensor.host,
								sensor.group,
								sensor.description,
								...(checksBySensor[sensor.id] ?? []).map((check) => check.label),
							].filter(Boolean)}
							detail={sensor.host}
							onDone={onDone}
						/>
					))}
				</CommandGroup>
			)}
			{remote.containers.length > 0 && (
				<CommandGroup heading={t`Containers`}>
					{remote.containers.map((container) => (
						<ObjectItem
							key={container.id}
							item={{ kind: "container", id: container.id, name: container.name }}
							value={`container ${container.id} ${container.name}`}
							keywords={[systemsById[container.system]?.name ?? ""]}
							detail={systemsById[container.system]?.name}
							onDone={onDone}
						/>
					))}
				</CommandGroup>
			)}
			{remote.services.length > 0 && (
				<CommandGroup heading={t`Services`}>
					{remote.services.map((service) => (
						<ObjectItem
							key={service.id}
							item={{ kind: "service", id: service.id, name: service.name }}
							value={`service ${service.id} ${service.name}`}
							keywords={[systemsById[service.system]?.name ?? ""]}
							detail={systemsById[service.system]?.name}
							onDone={onDone}
						/>
					))}
				</CommandGroup>
			)}
			<CommandSeparator className="mb-1.5" />
		</>
	)
}
