import { useLingui } from "@lingui/react/macro"
import { memo, useMemo } from "react"
import { FooterRepoLink } from "@/components/footer-repo-link"
import SystemdTable from "@/components/systemd-table/systemd-table"
import { usePageTitle } from "@/lib/instance"

export default memo(() => {
	const { t } = useLingui()

	usePageTitle(t`All Services`)

	return useMemo(
		() => (
			<>
				<div className="grid gap-4">
					<SystemdTable />
				</div>
				<FooterRepoLink />
			</>
		),
		[]
	)
})
