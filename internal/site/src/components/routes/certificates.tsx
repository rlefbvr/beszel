import { useLingui } from "@lingui/react/macro"
import { memo, useMemo } from "react"
import CertificatesTable from "@/components/certificates/certificates-table"
import { FooterRepoLink } from "@/components/footer-repo-link"
import { TraefikInstances } from "@/components/traefik/traefik-instances"
import { usePageTitle } from "@/lib/instance"

export default memo(() => {
	const { t } = useLingui()

	usePageTitle(t`Reverse proxy and certificates`)

	return useMemo(
		() => (
			<>
				{/* Traefik first, then the web certificates and the local ones */}
				<div className="grid gap-4 *:min-w-0">
					<TraefikInstances />
					<CertificatesTable />
				</div>
				<FooterRepoLink />
			</>
		),
		[]
	)
})
