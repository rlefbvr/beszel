import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { LoaderCircleIcon } from "lucide-react"
import { useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/use-toast"
import { $sensorGroups, addSensorChecks, type CheckDraft, portPresets } from "@/lib/sensors"
import type { SensorProtocol } from "@/types"

/** A sensor to create or complete, from the lines of the same host */
interface BulkSensor {
	host: string
	name: string
	group: string
	checks: CheckDraft[]
}

const protocols: SensorProtocol[] = ["icmp", "tcp", "http", "dns", "ntp"]

function draft(protocol: SensorProtocol, port: number, label: string): CheckDraft {
	return { protocol, port, label, url: "", keyword: "", accepted_codes: "", ignore_tls: false }
}

/**
 * Check of a service: a known one (ssh, https, ping…), a TCP port (8080) or a
 * protocol and port (http:8080, dns:53).
 */
function parseService(service: string, label: string): CheckDraft | string {
	const text = service.trim().toLowerCase()
	if (text === "ping") {
		return draft("icmp", 0, label || "Ping")
	}
	const preset = portPresets.find((preset) => preset.key === text)
	if (preset) {
		return draft(preset.protocol, preset.port, label || preset.label)
	}
	if (/^\d+$/.test(text)) {
		const port = Number(text)
		const known = portPresets.find((preset) => preset.protocol === "tcp" && preset.port === port)
		return port >= 1 && port <= 65535 ? draft("tcp", port, label || known?.label || "") : service
	}
	const [protocol, portText] = text.split(":")
	if (protocols.includes(protocol as SensorProtocol)) {
		const port = Number(portText) || (protocol === "dns" ? 53 : protocol === "ntp" ? 123 : protocol === "http" ? 80 : 0)
		if (protocol === "icmp" || (port >= 1 && port <= 65535)) {
			return draft(protocol as SensorProtocol, protocol === "icmp" ? 0 : port, label)
		}
	}
	return service
}

/** Sensors of the lines "host, services[, label[, group[, name]]]", the lines of a host grouped together */
function parseLines(input: string, defaultGroup: string) {
	const sensors = new Map<string, BulkSensor>()
	const errors: string[] = []
	input.split(/\r?\n/).forEach((line, index) => {
		if (!line.trim() || line.trim().startsWith("#")) {
			return
		}
		const lineNumber = index + 1
		const [host = "", services = "", label = "", rawGroup = "", rawName = ""] = line.split(",").map((part) => part.trim())
		// the lengths of the sensor fields
		const group = rawGroup.slice(0, 40).trim()
		const name = rawName.slice(0, 100).trim()
		if (!host) {
			errors.push(t`Line ${lineNumber}: the host is missing`)
			return
		}
		const key = host.toLowerCase()
		const sensor = sensors.get(key) ?? { host, name: name || host, group: group || defaultGroup, checks: [] }
		if (name && sensor.name === sensor.host) sensor.name = name
		if (group && !sensor.group) sensor.group = group
		const list = services ? services.split(/[+\s]+/).filter(Boolean) : ["ping"]
		for (const service of list) {
			const check = parseService(service, list.length === 1 ? label : "")
			if (typeof check === "string") {
				errors.push(t`Line ${lineNumber}: unknown service "${check}"`)
				continue
			}
			if (!sensor.checks.some((c) => c.protocol === check.protocol && c.port === check.port)) {
				sensor.checks.push(check)
			}
		}
		if (sensor.checks.length) {
			sensors.set(key, sensor)
		}
	})
	return { sensors: [...sensors.values()], errors }
}

/** Adds several sensors at once, one line per host or port; a host already checked gets the new ports */
export function SensorBulkAdd({ onDone }: { onDone: () => void }) {
	const groups = useStore($sensorGroups)
	const [input, setInput] = useState("")
	const [group, setGroup] = useState("")
	const [saving, setSaving] = useState(false)
	const formRef = useRef<HTMLFormElement>(null)
	const parsed = useMemo(() => parseLines(input, group.trim()), [input, group])
	const sensorCount = parsed.sensors.length
	const checkCount = parsed.sensors.reduce((sum, sensor) => sum + sensor.checks.length, 0)

	const submit = async (e: React.FormEvent) => {
		e.preventDefault()
		if (parsed.errors.length || !sensorCount) {
			return
		}
		setSaving(true)
		let created = 0
		let added = 0
		try {
			for (const sensor of parsed.sensors) {
				const result = await addSensorChecks(
					{ name: sensor.name, host: sensor.host, group: sensor.group, interval: 60, retries: 1 },
					sensor.checks
				)
				if (result.merged) {
					added += result.added
				} else {
					created++
				}
			}
			toast({
				title: t`Sensors added`,
				description: t`${created} new sensor(s), ${added} check(s) added to existing sensors.`,
			})
			onDone()
		} catch (err) {
			toast({ variant: "destructive", title: t`Error`, description: (err as Error).message })
		} finally {
			setSaving(false)
		}
	}

	return (
		<SheetContent className="w-full sm:max-w-xl gap-0">
			<SheetHeader className="border-b">
				<SheetTitle>
					<Trans>Bulk add sensors</Trans>
				</SheetTitle>
				<SheetDescription>
					<Trans>
						One line per host: host, services, label, group, name. Services are known ports (ssh, https, dns…), TCP port
						numbers or protocol:port, separated by +. The lines of the same host make one sensor.
					</Trans>
				</SheetDescription>
			</SheetHeader>
			<form ref={formRef} onSubmit={submit} className="flex h-full flex-col overflow-hidden">
				<div className="flex-1 flex flex-col gap-4 overflow-auto p-4">
					<div className="grid gap-1.5">
						<Label htmlFor="bulk-sensors-group">
							<Trans>Group of the lines without group</Trans>
						</Label>
						<Input
							id="bulk-sensors-group"
							value={group}
							onChange={(e) => setGroup(e.target.value)}
							list="bulk-sensor-groups"
							maxLength={40}
							className="bg-card"
						/>
						<datalist id="bulk-sensor-groups">
							{groups.map((name) => (
								<option key={name} value={name} />
							))}
						</datalist>
					</div>
					<div className="grow flex flex-col gap-2">
						<Label htmlFor="bulk-sensors" className="sr-only">
							<Trans>Sensors</Trans>
						</Label>
						<Textarea
							id="bulk-sensors"
							value={input}
							onChange={(e) => setInput(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
									e.preventDefault()
									formRef.current?.requestSubmit()
								}
							}}
							className="font-mono grow min-h-48 text-sm bg-card"
							placeholder={[
								"192.168.1.10, ping+ssh+rdp, , Servers, DC01",
								"nas.lan, https+smb, , Storage",
								"nas.lan, 5001, DSM",
								"8.8.8.8, dns, Google DNS, Internet",
								"proxmox.lan, proxmox",
							].join("\n")}
							required
						/>
						{parsed.errors.length > 0 ? (
							<ul className="text-xs text-destructive grid gap-0.5">
								{parsed.errors.slice(0, 5).map((error) => (
									<li key={error}>{error}</li>
								))}
							</ul>
						) : (
							sensorCount > 0 && (
								<p className="text-xs text-muted-foreground">
									<Trans>
										{sensorCount} host(s), {checkCount} check(s)
									</Trans>
								</p>
							)
						)}
					</div>
				</div>
				<SheetFooter className="border-t">
					<Button type="submit" className="gap-2" disabled={saving || !sensorCount || parsed.errors.length > 0}>
						{saving && <LoaderCircleIcon className="size-4 animate-spin" />}
						<Trans>Add sensors</Trans>
					</Button>
				</SheetFooter>
			</form>
		</SheetContent>
	)
}
