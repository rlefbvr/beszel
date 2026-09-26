import { t } from "@lingui/core/macro"
import { LoaderCircleIcon, WandSparklesIcon } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { toast } from "@/components/ui/use-toast"
import { pb } from "@/lib/api"

/** An IPv4 or IPv6 address, which needs no lookup */
const ipPattern = /^(\d{1,3}(\.\d{1,3}){3}|[\da-f:]*:[\da-f:.]*)$/i

/** Replaces a host name by its IP address, looked up by the hub */
export function ResolveIpButton({ host, onResolved }: { host: string; onResolved: (ip: string) => void }) {
	const [loading, setLoading] = useState(false)
	const name = host.trim()
	const label = t`Auto-discover the IP`

	const resolve = async () => {
		setLoading(true)
		try {
			const { addresses } = await pb.send<{ addresses: string[] }>("/api/beszel/resolve", {
				query: { host: name },
				requestKey: null,
			})
			onResolved(addresses[0])
			toast({ title: `${name} → ${addresses[0]}`, description: addresses.slice(1).join(", ") || undefined })
		} catch (err) {
			toast({ variant: "destructive", title: t`No address found for ${name}`, description: (err as Error).message })
		} finally {
			setLoading(false)
		}
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					type="button"
					variant="outline"
					size="icon"
					className="shrink-0"
					aria-label={label}
					disabled={loading || !name || ipPattern.test(name)}
					onClick={resolve}
				>
					{loading ? <LoaderCircleIcon className="size-4 animate-spin" /> : <WandSparklesIcon className="size-4" />}
				</Button>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	)
}
