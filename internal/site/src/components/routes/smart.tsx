import SmartTable from "@/components/routes/system/smart-table"
import { ActiveAlerts } from "@/components/active-alerts"
import { FooterRepoLink } from "@/components/footer-repo-link"
import { usePageTitle } from "@/lib/instance"

export default function Smart() {
	usePageTitle("S.M.A.R.T.")

	return (
		<>
			<div className="grid gap-4">
				<ActiveAlerts />
				<SmartTable />
			</div>
			<FooterRepoLink />
		</>
	)
}
