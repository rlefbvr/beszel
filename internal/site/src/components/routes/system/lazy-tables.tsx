import { lazy, useEffect, useRef } from "react"
import { useIntersectionObserver } from "@/lib/use-intersection-observer"
import { cn } from "@/lib/utils"
import { useNetworkMonitors } from "@/lib/use-network-monitors"
import { linkedTab } from "./use-system-data"

const ContainersTable = lazy(() => import("../../containers-table/containers-table"))

export function LazyContainersTable({ systemId }: { systemId: string }) {
	const { isIntersecting, ref } = useIntersectionObserver({ rootMargin: "90px" })
	return (
		<div ref={ref} className={cn(isIntersecting && "contents")}>
			{isIntersecting && <ContainersTable systemId={systemId} />}
		</div>
	)
}

const SmartTable = lazy(() => import("./smart-table"))

export function LazySmartTable({ systemId }: { systemId: string }) {
	const { isIntersecting, ref } = useIntersectionObserver({ rootMargin: "90px" })
	return (
		<div ref={ref} className={cn(isIntersecting && "contents")}>
			{isIntersecting && <SmartTable systemId={systemId} />}
		</div>
	)
}

const ZfsTable = lazy(() => import("./storage-pools-table"))

export function LazyZfsTable({ systemId }: { systemId: string }) {
	const { isIntersecting, ref } = useIntersectionObserver({ rootMargin: "90px" })
	return (
		<div ref={ref} className={cn(isIntersecting && "contents")}>
			{isIntersecting && <ZfsTable systemId={systemId} />}
		</div>
	)
}

const SystemdTable = lazy(() => import("../../systemd-table/systemd-table"))
const ProcessesTable = lazy(() => import("../../processes-table/processes-table"))

export function LazyProcessesTable({ systemId }: { systemId: string }) {
	const { isIntersecting, ref } = useIntersectionObserver()
	// a link to the processes of the host scrolls to them, once the charts above are drawn
	const anchor = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (linkedTab() !== "processes") {
			return
		}
		const timer = setTimeout(() => anchor.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 800)
		return () => clearTimeout(timer)
	}, [])
	return (
		<>
			<div ref={anchor} id="processes" className="scroll-mt-20" />
			<div ref={ref} className={cn(isIntersecting && "contents")}>
				{isIntersecting && <ProcessesTable systemId={systemId} />}
			</div>
		</>
	)
}

export function LazySystemdTable({ systemId }: { systemId: string }) {
	const { isIntersecting, ref } = useIntersectionObserver()
	return (
		<div ref={ref} className={cn(isIntersecting && "contents")}>
			{isIntersecting && <SystemdTable systemId={systemId} />}
		</div>
	)
}

const NetworkMonitorsTable = lazy(() => import("../../network-monitors-table/network-monitors-table"))

export function LazyNetworkMonitorsTable({ systemId }: { systemId: string }) {
	const { isIntersecting, ref } = useIntersectionObserver({ rootMargin: "90px" })
	return (
		<div ref={ref} className={cn(isIntersecting && "contents")}>
			{isIntersecting && <SystemNetworkMonitorsTable systemId={systemId} />}
		</div>
	)
}

function SystemNetworkMonitorsTable({ systemId }: { systemId: string }) {
	const { monitors, isLoading } = useNetworkMonitors({ systemId })
	return <NetworkMonitorsTable systemId={systemId} monitors={monitors} isLoading={isLoading} />
}

const RebootsTable = lazy(() => import("../../reboots-table"))

export function LazyRebootsTable({ systemId }: { systemId: string }) {
	const { isIntersecting, ref } = useIntersectionObserver({ rootMargin: "90px" })
	return (
		<div ref={ref} className={cn(isIntersecting && "contents")}>
			{isIntersecting && <RebootsTable systemId={systemId} />}
		</div>
	)
}
