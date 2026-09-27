import { Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { useId } from "react"
import { InputCopy } from "@/components/ui/input-copy"
import { $agentServiceName } from "@/lib/stores"

/**
 * Command giving the agent of a Linux host read access to the files owned by
 * root, in a drop-in of its service, like the install script does
 */
export function readAccessCommand(service: string) {
	const dir = `/etc/systemd/system/${service}.service.d`
	return `sudo mkdir -p ${dir} && printf '[Service]\\nAmbientCapabilities=CAP_DAC_READ_SEARCH\\n' | sudo tee ${dir}/read-certificates.conf && sudo systemctl daemon-reload && sudo systemctl restart ${service}`
}

/** When the agent could not read a file for lack of rights: how to give it read access */
export function ReadAccessHint({ error }: { error?: string }) {
	const service = useStore($agentServiceName)
	const id = useId()
	if (!error || !/permission denied/i.test(error)) {
		return null
	}
	return (
		<div className="grid gap-1.5 w-full text-xs text-muted-foreground">
			<span>
				<Trans>
					The agent can't read this file, owned by root. Give it read access on the host, or reinstall the agent with
					the install command:
				</Trans>
			</span>
			<InputCopy value={readAccessCommand(service)} id={id} name="read-access" />
		</div>
	)
}
