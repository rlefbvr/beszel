import { Plural, Trans } from "@lingui/react/macro"
import { ShieldAlertIcon, ShieldCheckIcon } from "lucide-react"
import type { ReactNode } from "react"
import { CheckBadge } from "@/components/sensors/sensor-badges"
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatDateTime, useNow } from "@/lib/time"
import { cn } from "@/lib/utils"
import type { SensorCertInfo, SensorCheckRecord } from "@/types"

/** Details of the TLS certificates of the HTTPS checks of a sensor */
export function SensorCertDialog({ checks }: { checks: SensorCheckRecord[] }) {
	const withCert = checks.filter((check) => check.cert)
	return (
		<DialogContent className="max-w-2xl w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto">
			<DialogHeader>
				<DialogTitle>
					<Trans>TLS certificate</Trans>
				</DialogTitle>
				<DialogDescription>
					<Trans>Certificate presented by the server at the last check.</Trans>
				</DialogDescription>
			</DialogHeader>
			<div className="grid gap-6">
				{withCert.map((check) => (
					<div key={check.id} className="grid gap-3">
						{withCert.length > 1 && (
							<div>
								<CheckBadge check={check} />
							</div>
						)}
						<CertDetails cert={check.cert as SensorCertInfo} />
					</div>
				))}
				{!withCert.length && (
					<p className="text-sm text-muted-foreground">
						<Trans>No certificate yet: the details appear after the next HTTPS check.</Trans>
					</p>
				)}
			</div>
		</DialogContent>
	)
}

function CertDetails({ cert }: { cert: SensorCertInfo }) {
	const now = useNow()
	const days = Math.floor((new Date(cert.notAfter).getTime() - now.getTime()) / 86_400_000)
	const expired = days < 0
	const expiredOn = formatDateTime(cert.notAfter)
	return (
		<div className="grid gap-4">
			<div
				className={cn(
					"flex items-start gap-3 rounded-lg border px-4 py-3 text-sm",
					cert.trusted && !expired ? "border-green-500/40 bg-green-500/10" : "border-orange-500/40 bg-orange-500/10"
				)}
			>
				{cert.trusted && !expired ? (
					<ShieldCheckIcon className="size-5 shrink-0 text-green-600 dark:text-green-400" />
				) : (
					<ShieldAlertIcon className="size-5 shrink-0 text-orange-600 dark:text-orange-400" />
				)}
				<div className="grid gap-0.5 min-w-0">
					<p className="font-medium">
						{expired ? (
							<Trans>Expired certificate</Trans>
						) : cert.trusted ? (
							<Trans>Valid and trusted certificate</Trans>
						) : (
							<Trans>Certificate not trusted by the hub</Trans>
						)}
					</p>
					<p className="text-muted-foreground">
						{expired ? (
							<Trans>Expired on {expiredOn}</Trans>
						) : (
							<Plural value={days} one="Expires in # day" other="Expires in # days" />
						)}
					</p>
					{!cert.trusted && cert.trustError && <p className="text-muted-foreground break-words">{cert.trustError}</p>}
				</div>
			</div>

			<dl className="grid sm:grid-cols-[10rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
				<Row label={<Trans>Issued to</Trans>}>
					<span className="font-medium">{cert.subject}</span>
					{cert.subjectDN !== cert.subject && <Muted>{cert.subjectDN}</Muted>}
				</Row>
				<Row label={<Trans>Issued by</Trans>}>
					<span className="font-medium">{cert.issuer}</span>
					{cert.issuerDN !== cert.issuer && <Muted>{cert.issuerDN}</Muted>}
				</Row>
				{!!cert.names?.length && (
					<Row label={<Trans>Alternative names</Trans>}>
						<span className="flex flex-wrap gap-1">
							{cert.names.map((name) => (
								<span key={name} className="rounded bg-muted px-1.5 py-0.5 text-xs">
									{name}
								</span>
							))}
						</span>
					</Row>
				)}
				<Row label={<Trans>Valid from</Trans>}>
					<span className="tabular-nums">{formatDateTime(cert.notBefore)}</span>
				</Row>
				<Row label={<Trans>Valid until</Trans>}>
					<span className="tabular-nums">{formatDateTime(cert.notAfter)}</span>
				</Row>
				<Row label={<Trans>Public key</Trans>}>{cert.publicKey}</Row>
				<Row label={<Trans>Signature</Trans>}>{cert.signature}</Row>
				<Row label={<Trans>Protocol</Trans>}>
					{cert.tlsVersion}
					<Muted>{cert.cipher}</Muted>
				</Row>
				<Row label={<Trans>Serial number</Trans>}>
					<span className="font-mono text-xs break-all">{cert.serial}</span>
				</Row>
				<Row label={<Trans>SHA-256 fingerprint</Trans>}>
					<span className="font-mono text-xs break-all">{cert.sha256}</span>
				</Row>
			</dl>

			{!!cert.chain?.length && (
				<div className="grid gap-2 text-sm">
					<p className="font-medium">
						<Trans>Chain</Trans>
					</p>
					<ol className="grid gap-1.5 border-s ps-4">
						{cert.chain.map((link) => {
							const linkIssuer = link.issuer
							const linkUntil = formatDateTime(link.notAfter)
							return (
								<li key={`${link.subject}${link.notAfter}`} className="grid">
									<span>{link.subject}</span>
									<Muted>
										<Trans>
											Issued by {linkIssuer}, valid until {linkUntil}
										</Trans>
									</Muted>
								</li>
							)
						})}
					</ol>
				</div>
			)}
		</div>
	)
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
	return (
		<>
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="grid min-w-0 break-words">{children}</dd>
		</>
	)
}

function Muted({ children }: { children: ReactNode }) {
	return <span className="text-xs text-muted-foreground break-words">{children}</span>
}
