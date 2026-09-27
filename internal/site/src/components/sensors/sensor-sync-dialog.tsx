import { t } from "@lingui/core/macro"
import { Plural, Trans } from "@lingui/react/macro"
import { LoaderCircleIcon, NetworkIcon } from "lucide-react"
import { useEffect, useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "@/components/ui/use-toast"
import { isReadOnlyUser, pb, queueUserSettings } from "@/lib/api"
import { createPings, type MissingPing, missingPings } from "@/lib/sensor-sync"

/**
 * The hosts without ping (ICMP) sensor, to follow them with one: after a
 * login (with "don't ask again") or from the settings.
 */
export function SensorSyncDialog({
	hosts,
	askAgain,
	onClose,
}: {
	hosts: MissingPing[]
	/** after a login: offers to stop asking */
	askAgain?: boolean
	onClose: () => void
}) {
	const [chosen, setChosen] = useState(() => new Set(hosts.map((host) => host.host)))
	const [dontAsk, setDontAsk] = useState(false)
	const [saving, setSaving] = useState(false)
	const dontAskId = useId()
	const count = hosts.length
	const chosenCount = chosen.size

	const close = () => {
		if (dontAsk) {
			queueUserSettings({ sensorSyncPrompt: false })
		}
		onClose()
	}

	const create = async () => {
		setSaving(true)
		try {
			const { created, added } = await createPings(hosts.filter((host) => chosen.has(host.host)))
			toast({
				title: t`Ping sensors created`,
				description: t`${created} new sensor(s), ${added} check(s) added to existing sensors.`,
			})
			close()
		} catch (err) {
			toast({ variant: "destructive", title: t`Error`, description: (err as Error).message })
		} finally {
			setSaving(false)
		}
	}

	const toggle = (host: string, checked: boolean) =>
		setChosen((current) => {
			const next = new Set(current)
			if (checked) {
				next.add(host)
			} else {
				next.delete(host)
			}
			return next
		})

	return (
		<Dialog open onOpenChange={(open) => !open && !saving && close()}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<NetworkIcon className="size-5" />
						<Trans>Hosts without ping sensor</Trans>
					</DialogTitle>
					<DialogDescription>
						<Plural
							value={count}
							one="# host has no ping (ICMP) sensor. A ping sensor shows whether it answers on the network, even when its agent is down."
							other="# hosts have no ping (ICMP) sensor. A ping sensor shows whether they answer on the network, even when their agent is down."
						/>
					</DialogDescription>
				</DialogHeader>
				<div className="max-h-72 overflow-auto rounded-md border divide-y">
					{hosts.map((host) => {
						const sensorName = host.sensor?.name
						return (
							<label key={host.host} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer">
								<Checkbox
									checked={chosen.has(host.host)}
									onCheckedChange={(checked) => toggle(host.host, checked === true)}
								/>
								<span className="grid min-w-0">
									<span className="truncate font-medium">{host.name}</span>
									<span className="truncate text-xs text-muted-foreground">
										{host.host}
										{sensorName ? (
											<>
												{" · "}
												<Trans>ping added to the sensor {sensorName}</Trans>
											</>
										) : (
											<>
												{" · "}
												<Trans>new sensor</Trans>
											</>
										)}
									</span>
								</span>
							</label>
						)
					})}
				</div>
				<DialogFooter className="gap-3 sm:items-center">
					{askAgain && (
						<div className="flex items-center gap-2 text-sm me-auto">
							<Checkbox id={dontAskId} checked={dontAsk} onCheckedChange={(checked) => setDontAsk(checked === true)} />
							<label htmlFor={dontAskId} className="cursor-pointer">
								<Trans>Don't ask again</Trans>
							</label>
						</div>
					)}
					<Button variant="outline" disabled={saving} onClick={close}>
						<Trans>Not now</Trans>
					</Button>
					<Button disabled={saving || !chosenCount} onClick={create} className="gap-2">
						{saving && <LoaderCircleIcon className="size-4 animate-spin" />}
						<Plural value={chosenCount} one="Create # sensor" other="Create # sensors" />
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

/** After a login: the hosts without ping sensor, unless the user asked not to be asked again */
export function SensorSyncAfterLogin({ onDone }: { onDone: () => void }) {
	const [hosts, setHosts] = useState<MissingPing[]>()

	useEffect(() => {
		;(async () => {
			try {
				if (isReadOnlyUser()) {
					return onDone()
				}
				const { settings } = await pb.collection("user_settings").getFirstListItem("", { fields: "settings" })
				if (settings?.sensorSyncPrompt === false) {
					return onDone()
				}
				const missing = await missingPings()
				missing.length ? setHosts(missing) : onDone()
			} catch {
				onDone()
			}
		})()
	}, [])

	return hosts ? <SensorSyncDialog hosts={hosts} askAgain onClose={onDone} /> : null
}

/** Button of the settings: the same check, on demand */
export function SensorSyncButton() {
	const [hosts, setHosts] = useState<MissingPing[]>()
	const [loading, setLoading] = useState(false)

	const check = async () => {
		setLoading(true)
		try {
			const missing = await missingPings()
			if (missing.length) {
				setHosts(missing)
			} else {
				toast({ title: t`Every host has a ping sensor.` })
			}
		} catch (err) {
			toast({ variant: "destructive", title: t`Error`, description: (err as Error).message })
		} finally {
			setLoading(false)
		}
	}

	return (
		<>
			<Button
				type="button"
				variant="outline"
				className="gap-2 w-fit"
				disabled={loading}
				onClick={check}
			>
				{loading ? <LoaderCircleIcon className="size-4 animate-spin" /> : <NetworkIcon className="size-4" />}
				<Trans>Sync hosts and sensors</Trans>
			</Button>
			{hosts && <SensorSyncDialog hosts={hosts} onClose={() => setHosts(undefined)} />}
		</>
	)
}
