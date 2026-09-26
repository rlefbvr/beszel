import { useLingui } from "@lingui/react/macro"
import { memo, Suspense, useMemo } from "react"
import SystemsTable from "@/components/systems-table/systems-table"
import { FooterRepoLink } from "@/components/footer-repo-link"
import { QuietHoursBanner } from "@/components/quiet-hours-banner"
import { usePageTitle } from "@/lib/instance"

export default memo(() => {
	const { t } = useLingui()

	usePageTitle(t`All Systems`)

	return useMemo(
		() => (
			<>
				<div className="flex flex-col gap-4">
					<QuietHoursBanner />
					<Suspense>
						<SystemsTable />
					</Suspense>
				</div>
				<FooterRepoLink />
			</>
		),
		[]
	)
})
