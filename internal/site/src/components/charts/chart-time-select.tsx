import { useStore } from "@nanostores/react"
import { HistoryIcon } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { $chartPeriods, $chartTime } from "@/lib/stores"
import { chartTimeData, cn, compareSemVer, parseSemVer } from "@/lib/utils"
import type { ChartTimes, SemVer } from "@/types"
import { memo, useEffect } from "react"

export default memo(function ChartTimeSelect({
	className,
	agentVersion,
	chartTimeStore = $chartTime,
	allowRealtime = true,
}: {
	className?: string
	agentVersion: SemVer
	chartTimeStore?: typeof $chartTime
	allowRealtime?: boolean
}) {
	const chartTime = useStore(chartTimeStore)
	const periods = useStore($chartPeriods)

	// chart times offered by the hub settings and supported by the system agent version
	const availableChartTimes = Object.entries(chartTimeData).filter(([value, { minVersion }]) => {
		if ((value === "1m" && !allowRealtime) || !periods.includes(value as ChartTimes)) {
			return false
		}
		if (!minVersion) {
			return true
		}
		return compareSemVer(agentVersion, parseSemVer(minVersion)) >= 0
	})

	// a period removed from the settings falls back to the shortest one offered
	const available = availableChartTimes.some(([value]) => value === chartTime)
	const fallback = (availableChartTimes.find(([value]) => value !== "1m") ?? availableChartTimes[0])?.[0] as ChartTimes
	useEffect(() => {
		if (!available && fallback) {
			chartTimeStore.set(fallback)
		}
	}, [available, fallback, chartTimeStore])

	return (
		<Select defaultValue="1h" value={chartTime} onValueChange={(value: ChartTimes) => chartTimeStore.set(value)}>
			<SelectTrigger className={cn(className, "relative ps-10 pe-5")}>
				<HistoryIcon className="h-4 w-4 absolute start-4 top-1/2 -translate-y-1/2 opacity-85" />
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{availableChartTimes.map(([value, { label }]) => (
					<SelectItem key={value} value={value}>
						{label()}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	)
})
