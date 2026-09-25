import { useLingui } from "@lingui/react/macro"
import { memo } from "react"
import NetworkMonitorsTableNew from "@/components/network-monitors-table/network-monitors-table"
import { ActiveAlerts } from "@/components/active-alerts"
import { FooterRepoLink } from "@/components/footer-repo-link"
import { useNetworkMonitors } from "@/lib/use-network-monitors"
import { $allSystemsById } from "@/lib/stores"
import { supportsNetworkMonitors } from "@/lib/utils"
import { useStore } from "@nanostores/react"
import { usePageTitle } from "@/lib/instance"

export default memo(() => {
	const { t } = useLingui()
	const { monitors, isLoading } = useNetworkMonitors({})
	const systems = useStore($allSystemsById)
	const visibleMonitors = monitors.filter((monitor) => {
		const system = systems[monitor.system]
		return !system || supportsNetworkMonitors(system)
	})

	usePageTitle(t`Network Monitors`)

	return (
		<>
			<div className="grid gap-4">
				<ActiveAlerts />
				<NetworkMonitorsTableNew monitors={visibleMonitors} isLoading={isLoading} />
			</div>
			<FooterRepoLink />
		</>
	)
})
