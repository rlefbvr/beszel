import { useLingui } from "@lingui/react/macro"
import { memo, useMemo } from "react"
import { ActiveAlerts } from "@/components/active-alerts"
import CertificatesTable from "@/components/certificates/certificates-table"
import { FooterRepoLink } from "@/components/footer-repo-link"
import { usePageTitle } from "@/lib/instance"

export default memo(() => {
	const { t } = useLingui()

	usePageTitle(t`All certificates`)

	return useMemo(
		() => (
			<>
				<div className="grid gap-4">
					<ActiveAlerts />
					<CertificatesTable />
				</div>
				<FooterRepoLink />
			</>
		),
		[]
	)
})
