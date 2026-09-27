import { Plural, Trans } from "@lingui/react/macro"
import { cn } from "@/lib/utils"

/** Days before expiry when a certificate shows as expiring */
export const expiringDays = 30

/** Common name of a distinguished name, such as R11 in CN=R11,O=Let's Encrypt,C=US */
export function commonName(dn: string) {
	return /(?:^|,)\s*CN=([^,]+)/.exec(dn)?.[1] ?? dn
}

/** Color of the days left: red once expired, orange when expiring, green otherwise */
function daysClass(days: number | null) {
	if (days === null) {
		return "bg-muted text-muted-foreground"
	}
	if (days < 0) {
		return "bg-red-500/15 text-red-700 dark:text-red-400"
	}
	if (days <= expiringDays) {
		return "bg-orange-500/15 text-orange-700 dark:text-orange-400"
	}
	return "bg-green-500/15 text-green-700 dark:text-green-400"
}

/** Days left before a certificate expires, colored by how soon */
export function DaysLeft({ days }: { days: number | null }) {
	return (
		<span className={cn("rounded px-1.5 py-0.5 text-xs font-medium tabular-nums whitespace-nowrap", daysClass(days))}>
			{days === null ? "-" : days < 0 ? <Trans>Expired</Trans> : <Plural value={days} one="# day" other="# days" />}
		</span>
	)
}
