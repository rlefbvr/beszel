import { useLingui } from "@lingui/react/macro"
import { memo, useEffect, useMemo } from "react"
import { ActiveAlerts } from "@/components/active-alerts"
import { FooterRepoLink } from "@/components/footer-repo-link"
import RebootsTable from "@/components/reboots-table"

export default memo(() => {
	const { t } = useLingui()

	useEffect(() => {
		document.title = `${t`All Reboots`} / Beszel`
	}, [t])

	return useMemo(
		() => (
			<>
				<div className="grid gap-4">
					<ActiveAlerts />
					<RebootsTable />
				</div>
				<FooterRepoLink />
			</>
		),
		[]
	)
})
