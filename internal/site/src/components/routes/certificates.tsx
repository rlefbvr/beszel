import { useLingui } from "@lingui/react/macro"
import { memo, useMemo } from "react"
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
					<CertificatesTable />
				</div>
				<FooterRepoLink />
			</>
		),
		[]
	)
})
