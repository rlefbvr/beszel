import { useEffect, useState } from "react"
import { getPbTimestamp, pb } from "@/lib/api"
import { chartTimeData } from "@/lib/utils"
import type { ChartTimes, SensorStatsRecord } from "@/types"

const statsFields = "sensor,check,type,created,total_count,success_count,res_sum,res_min,res_max"

/** Stats of a sensor over a chart period, refreshed every minute */
export function useSensorStats(sensorId: string, chartTime: ChartTimes) {
	const [stats, setStats] = useState<SensorStatsRecord[]>([])
	const [loading, setLoading] = useState(true)
	useEffect(() => {
		let cancelled = false
		setLoading(true)
		setStats([])
		const load = async () => {
			try {
				const records = await pb.collection<SensorStatsRecord>("sensor_stats").getFullList({
					filter: pb.filter("sensor={:sensor} && type={:type} && created>{:since}", {
						sensor: sensorId,
						type: chartTimeData[chartTime].type,
						since: getPbTimestamp(chartTime, undefined, true),
					}),
					fields: statsFields,
					sort: "created",
					requestKey: `sensor-stats-${sensorId}-${chartTime}`,
				})
				if (!cancelled) {
					setStats(records)
				}
			} catch {
				// canceled by a newer request
			} finally {
				if (!cancelled) {
					setLoading(false)
				}
			}
		}
		load()
		const timer = setInterval(load, 60_000)
		return () => {
			cancelled = true
			clearInterval(timer)
		}
	}, [sensorId, chartTime])
	return { stats, loading }
}

/** Totals of stats records: probes, successes, uptime (%), loss (%) and average response time (ms) */
export function sumStats(records: SensorStatsRecord[]) {
	let total = 0
	let success = 0
	let resSum = 0
	for (const record of records) {
		total += record.total_count
		success += record.success_count
		resSum += record.res_sum
	}
	return {
		total,
		success,
		uptime: total ? (success * 100) / total : null,
		loss: total ? ((total - success) * 100) / total : null,
		res: success ? resSum / success / 1000 : null,
	}
}
