import { useLingui } from "@lingui/react/macro"
import { memo, useMemo } from "react"
import { ActiveAlerts } from "@/components/active-alerts"
import { FooterRepoLink } from "@/components/footer-repo-link"
import ProcessesOverviewPage from "@/components/processes-table/processes-overview"
import { usePageTitle } from "@/lib/instance"

export default memo(() => {
	const { t } = useLingui()

	usePageTitle(t`All processes`)

	return useMemo(
		() => (
			<>
				<div className="grid gap-4">
					<ActiveAlerts />
					<ProcessesOverviewPage />
				</div>
				<FooterRepoLink />
			</>
		),
		[]
	)
})
