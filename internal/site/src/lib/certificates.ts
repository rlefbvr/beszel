import { t } from "@lingui/core/macro"
import { map, onMount } from "nanostores"
import { pb } from "@/lib/api"
import type { CertificateAlertRecord, CertificatePathRecord, CertificateRecord, CertificateUse } from "@/types"

/** Keeps a collection in a store while it is used, updated in real time */
function syncCollection<T extends { id: string }>(store: ReturnType<typeof map<Record<string, T>>>, collection: string) {
	onMount(store, () => {
		let unsubscribe: (() => void) | undefined
		let cancelled = false
		;(async () => {
			try {
				const records = await pb.collection<T>(collection).getFullList({ requestKey: null })
				if (cancelled) {
					return
				}
				store.set(Object.fromEntries(records.map((record) => [record.id, record])))
				unsubscribe = await pb.collection<T>(collection).subscribe("*", ({ action, record }) => {
					if (action === "delete") {
						const { [record.id]: _, ...rest } = store.get()
						store.set(rest)
					} else {
						store.setKey(record.id, record)
					}
				})
			} catch (e) {
				console.error("get", collection, e)
			}
		})()
		return () => {
			cancelled = true
			unsubscribe?.()
		}
	})
}

/** Certificates found on the hosts, by id */
export const $certificates = map<Record<string, CertificateRecord>>({})
syncCollection($certificates, "certificates")

/** Certificate files added by the users, by id */
export const $certificatePaths = map<Record<string, CertificatePathRecord>>({})
syncCollection($certificatePaths, "certificate_paths")

/** Expiry alerts of the user, by id: the certificates they check are the important ones */
export const $certificateAlerts = map<Record<string, CertificateAlertRecord>>({})
syncCollection($certificateAlerts, "certificate_alerts")

/** Days left before a certificate expires, negative once expired */
export function certificateDaysLeft(cert: Pick<CertificateRecord, "not_after">, now = new Date()) {
	if (!cert.not_after) {
		return null
	}
	return Math.floor((new Date(cert.not_after).getTime() - now.getTime()) / 86_400_000)
}

/** Default number of days before expiry for a new alert */
export const defaultCertificateAlertDays = 30

/** Expiry alert of the user on the certificates of a name on a system */
export function certificateAlertOf(
	alerts: Record<string, CertificateAlertRecord>,
	cert: Pick<CertificateRecord, "system" | "name">
) {
	const name = cert.name.toLowerCase()
	return Object.values(alerts).find((alert) => alert.system === cert.system && alert.name.toLowerCase() === name)
}

/** Name of the service configuring a certificate */
export const certificateUseLabels: Record<string, () => string> = {
	nginx: () => "nginx",
	apache: () => "Apache",
	haproxy: () => "HAProxy",
	postfix: () => "Postfix",
	dovecot: () => "Dovecot",
	letsencrypt: () => "Let's Encrypt",
	proxmox: () => "Proxmox VE",
	cockpit: () => "Cockpit",
	iis: () => "IIS",
	httpsys: () => "HTTP.sys",
	rdp: () => t`Remote Desktop`,
	winrm: () => "WinRM",
	file: () => t`File`,
}

export function certificateUseLabel(use: Pick<CertificateUse, "kind">) {
	return certificateUseLabels[use.kind]?.() ?? use.kind
}

/** A step of the recap: a sentence, the part of it shown in bold, and a path or command to copy */
export interface CertificateStep {
	text: string
	bold?: string
	code?: string
}

/** Name of the file of a path: "fullchain.pem" in /etc/letsencrypt/live/example.com/fullchain.pem */
export function fileName(path: string) {
	return path.split(/[\\/]/).pop() || path
}

/** Configuration directives and services of the certificate files of Linux services */
const serviceFiles: Record<string, { directive: string; service: string }> = {
	nginx: { directive: "ssl_certificate", service: "nginx (nginx -s reload)" },
	apache: { directive: "SSLCertificateFile", service: "Apache" },
	haproxy: { directive: "crt", service: "HAProxy" },
	postfix: { directive: "smtpd_tls_cert_file", service: "Postfix" },
	dovecot: { directive: "ssl_cert", service: "Dovecot" },
}

/** Where and how to change the certificate of a use, for the recap of the important certificates */
export function certificateUseSteps(use: CertificateUse, cert: Pick<CertificateRecord, "path">): CertificateStep[] {
	const location = use.location ?? ""
	const detail = use.detail ?? ""
	const path = cert.path
	const replace = (file: string): CertificateStep => {
		const name = fileName(file)
		return { text: t`Replace the file ${name} reachable at the following path:`, bold: name, code: file }
	}
	const config = serviceFiles[use.kind]
	if (config) {
		const { directive, service } = config
		return [
			replace(path),
			{ text: t`Or change ${directive} in the following file, then reload ${service}:`, code: location },
		]
	}
	switch (use.kind) {
		case "letsencrypt":
			return [{ text: t`Renewed by certbot (certbot renew), with the settings of the following file:`, code: location }]
		case "proxmox":
			return [
				{ text: t`In Proxmox VE: node > System > Certificates.` },
				replace(location),
				{ text: t`Then restart pveproxy.` },
			]
		case "cockpit":
			return [replace(location), { text: t`Then restart cockpit.` }]
		case "iis":
			return [
				{
					text: detail
						? t`In IIS Manager: site ${detail} > Bindings > https ${location} > SSL certificate.`
						: t`In IIS Manager: the site bound to https ${location} > Bindings > SSL certificate.`,
				},
			]
		case "httpsys":
			return [
				{
					text: t`Run the following command with the thumbprint of the new certificate (application ${detail}):`,
					code: `netsh http update sslcert ipport=${location} certhash=<thumbprint>`,
				},
			]
		case "rdp":
			return [
				{
					text: t`Set the thumbprint of the new certificate in the following place (or in the Win32_TSGeneralSetting WMI class), then restart the Remote Desktop service:`,
					code: location,
				},
			]
		case "winrm":
			return [
				{
					text: t`Run the following command with the thumbprint of the new certificate:`,
					code: `winrm set ${location} @{CertificateThumbprint="<thumbprint>"}`,
				},
			]
		case "file":
			return [replace(location)]
	}
	return location ? [{ text: "", code: location }] : []
}
