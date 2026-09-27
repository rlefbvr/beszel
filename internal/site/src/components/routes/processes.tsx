import { useLingui } from "@lingui/react/macro"
import { memo, useMemo } from "react"
import { FooterRepoLink } from "@/components/footer-repo-link"
import ProcessesOverviewPage from "@/components/processes-table/processes-overview"
import { usePageTitle } from "@/lib/instance"

export default memo(() => {
	const { t } = useLingui()

	usePageTitle(t`All processes`)

	return useMemo(
		() => (
			<>
				{/* the blocks shrink to the page, their long names truncated */}
				<div className="grid gap-4 *:min-w-0">
					<ProcessesOverviewPage />
				</div>
				<FooterRepoLink />
			</>
		),
		[]
	)
})
