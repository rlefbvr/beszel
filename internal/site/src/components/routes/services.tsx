import { useLingui } from "@lingui/react/macro"
import { memo, useEffect, useMemo } from "react"
import { ActiveAlerts } from "@/components/active-alerts"
import { FooterRepoLink } from "@/components/footer-repo-link"
import SystemdTable from "@/components/systemd-table/systemd-table"

export default memo(() => {
	const { t } = useLingui()

	useEffect(() => {
		document.title = `${t`All Services`} / Beszel`
	}, [t])

	return useMemo(
		() => (
			<>
				<div className="grid gap-4">
					<ActiveAlerts />
					<SystemdTable />
				</div>
				<FooterRepoLink />
			</>
		),
		[]
	)
})
