import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { getPagePath } from "@nanostores/router"
import { NetworkIcon, ServerIcon } from "lucide-react"
import { useId, useState } from "react"
import { $router, Link } from "@/components/router"
import { buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { $sensors } from "@/lib/sensors"
import { $allSystemsById } from "@/lib/stores"
import { cn } from "@/lib/utils"

/** Address compared to associate a system and a sensor: the same host or IP, without case */
const sameHost = (a?: string, b?: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()

/** System sharing the address of a sensor */
export function useHostSystem(host: string) {
	const systems = useStore($allSystemsById)
	return Object.values(systems).find((system) => sameHost(system.host, host))
}

/** Button of a toolbar opening a page, followed by a separator from the other buttons */
function LinkButton({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
	return (
		<>
			<Tooltip>
				<TooltipTrigger asChild>
					<Link href={href} aria-label={label} className={cn(buttonVariants({ variant: "outline", size: "icon" }))}>
						{children}
					</Link>
				</TooltipTrigger>
				<TooltipContent>{label}</TooltipContent>
			</Tooltip>
			<Separator orientation="vertical" className="h-6 mx-1" />
		</>
	)
}

/** On a system page: the sensor sharing its address, if any */
export function SensorLinkButton({ host }: { host: string }) {
	const sensors = useStore($sensors)
	const sensor = Object.values(sensors).find((item) => sameHost(item.host, host))
	if (!sensor) {
		return null
	}
	return (
		<LinkButton href={getPagePath($router, "sensor", { id: sensor.id })} label={t`Sensor`}>
			<NetworkIcon className="size-4" />
		</LinkButton>
	)
}

/** On a sensor page: the system sharing its address, if any */
export function HostLinkButton({ host }: { host: string }) {
	const system = useHostSystem(host)
	if (!system) {
		return null
	}
	return (
		<LinkButton href={getPagePath($router, "system", { id: system.id })} label={t`Host`}>
			<ServerIcon className="size-4" />
		</LinkButton>
	)
}

/** Checkbox of a deletion confirmation: also delete the associated object */
function LinkedDeleteOption({ label, onChange }: { label: React.ReactNode; onChange: (checked: boolean) => void }) {
	const id = useId()
	const [checked, setChecked] = useState(false)
	return (
		<div className="flex items-start gap-2 text-sm">
			<Checkbox
				id={id}
				className="mt-0.5"
				checked={checked}
				onCheckedChange={(value) => {
					setChecked(value === true)
					onChange(value === true)
				}}
			/>
			<label htmlFor={id} className="cursor-pointer">
				{label}
			</label>
		</div>
	)
}

/** In the deletion of a system: offers to delete the sensor sharing its address; onChange gets its id or null */
export function LinkedSensorDeleteOption({
	host,
	onChange,
}: {
	host: string
	onChange: (sensorId: string | null) => void
}) {
	const sensors = useStore($sensors)
	const sensor = Object.values(sensors).find((item) => sameHost(item.host, host))
	if (!sensor) {
		return null
	}
	const sensorName = sensor.name
	return (
		<LinkedDeleteOption
			label={<Trans>Also delete the associated sensor {sensorName}</Trans>}
			onChange={(checked) => onChange(checked ? sensor.id : null)}
		/>
	)
}

/** In the deletion of a sensor: offers to delete the system sharing its address; onChange gets its id or null */
export function LinkedSystemDeleteOption({
	host,
	onChange,
}: {
	host: string
	onChange: (systemId: string | null) => void
}) {
	const system = useHostSystem(host)
	if (!system) {
		return null
	}
	const systemName = system.name
	return (
		<LinkedDeleteOption
			label={<Trans>Also delete the associated host {systemName} and its records</Trans>}
			onChange={(checked) => onChange(checked ? system.id : null)}
		/>
	)
}

/** Badge of a sensor sharing the address of a system, with the name of the system on hover */
export function HostBadge({ host, className }: { host: string; className?: string }) {
	const system = useHostSystem(host)
	if (!system) {
		return null
	}
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span
					className={cn(
						"inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[0.65rem] font-medium leading-none text-muted-foreground",
						className
					)}
				>
					<ServerIcon className="size-3" />
					<Trans>Host</Trans>
				</span>
			</TooltipTrigger>
			<TooltipContent>{system.name}</TooltipContent>
		</Tooltip>
	)
}
