import { lazy, useEffect, useRef } from "react"
import { useIntersectionObserver } from "@/lib/use-intersection-observer"
import { cn } from "@/lib/utils"
import { useNetworkMonitors } from "@/lib/use-network-monitors"
import { linkedSectionEvent, linkedTab } from "@/lib/linked-section"

/**
 * Anchor of a part of the page that a link opens (#containers, #processes,
 * #services): scrolls to it once the charts above are drawn, or at once when
 * an alert of the page already shown asks for it.
 */
function LinkedAnchor({ id }: { id: string }) {
	const anchor = useRef<HTMLDivElement>(null)
	useEffect(() => {
		const scroll = (delay: number) =>
			setTimeout(() => anchor.current?.scrollIntoView({ behavior: "smooth", block: "start" }), delay)
		let timer = linkedTab() === id ? scroll(800) : undefined
		const onLink = (e: Event) => {
			if ((e as CustomEvent<string>).detail === id) {
				clearTimeout(timer)
				timer = scroll(100)
			}
		}
		window.addEventListener(linkedSectionEvent, onLink)
		return () => {
			clearTimeout(timer)
			window.removeEventListener(linkedSectionEvent, onLink)
		}
	}, [id])
	return <div ref={anchor} id={id} className="scroll-mt-20" />
}

const ContainersTable = lazy(() => import("../../containers-table/containers-table"))

export function LazyContainersTable({ systemId }: { systemId: string }) {
	const { isIntersecting, ref } = useIntersectionObserver({ rootMargin: "90px" })
	return (
		<>
			<LinkedAnchor id="containers" />
			<div ref={ref} className={cn(isIntersecting && "contents")}>
				{isIntersecting && <ContainersTable systemId={systemId} />}
			</div>
		</>
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
	return (
		<>
			<LinkedAnchor id="processes" />
			<div ref={ref} className={cn(isIntersecting && "contents")}>
				{isIntersecting && <ProcessesTable systemId={systemId} />}
			</div>
		</>
	)
}

export function LazySystemdTable({ systemId }: { systemId: string }) {
	const { isIntersecting, ref } = useIntersectionObserver()
	return (
		<>
			<LinkedAnchor id="services" />
			<div ref={ref} className={cn(isIntersecting && "contents")}>
				{isIntersecting && <SystemdTable systemId={systemId} />}
			</div>
		</>
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
