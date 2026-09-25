import { useLingui } from "@lingui/react/macro"
import { memo, useMemo } from "react"
import ContainersTable from "@/components/containers-table/containers-table"
import { ActiveAlerts } from "@/components/active-alerts"
import { FooterRepoLink } from "@/components/footer-repo-link"
import { usePageTitle } from "@/lib/instance"

export default memo(() => {
	const { t } = useLingui()

	usePageTitle(t`All Containers`)

	return useMemo(
		() => (
			<>
				<div className="grid gap-4">
					<ActiveAlerts />
					<ContainersTable />
				</div>
				<FooterRepoLink />
			</>
		),
		[]
	)
})
