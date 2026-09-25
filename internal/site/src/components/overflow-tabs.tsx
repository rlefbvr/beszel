import { useLingui } from "@lingui/react/macro"
import { ChevronDownIcon } from "lucide-react"
import { type ReactNode, useLayoutEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

export interface OverflowTab {
	value: string
	/** content of the tab: icon, label and count */
	label: ReactNode
	/** text of the tab, for its tooltip */
	title?: string
}

/** Width kept for the button listing the tabs that don't fit */
const moreButtonWidth = 64

/**
 * Tabs on one line: the tabs that don't fit are listed by a button after the
 * visible ones. The selected tab always stays visible.
 */
export function OverflowTabs({
	tabs,
	value,
	onChange,
	className,
}: {
	tabs: OverflowTab[]
	value: string
	onChange: (value: string) => void
	className?: string
}) {
	const { t } = useLingui()
	const containerRef = useRef<HTMLDivElement>(null)
	const measureRef = useRef<HTMLDivElement>(null)
	const [fitCount, setFitCount] = useState(tabs.length)

	// count the tabs fitting in the width, measured on an invisible copy of all the tabs
	useLayoutEffect(() => {
		const container = containerRef.current
		const measure = measureRef.current
		if (!container || !measure) {
			return
		}
		const update = () => {
			const available = container.clientWidth
			const widths = [...measure.children].map((child) => (child as HTMLElement).offsetWidth + 4)
			const total = widths.reduce((sum, width) => sum + width, 0) + 8
			if (total <= available) {
				setFitCount(tabs.length)
				return
			}
			let used = 8 + moreButtonWidth
			let count = 0
			for (const width of widths) {
				if (used + width > available) {
					break
				}
				used += width
				count++
			}
			setFitCount(Math.max(1, count))
		}
		update()
		const observer = new ResizeObserver(update)
		observer.observe(container)
		return () => observer.disconnect()
	}, [tabs])

	// the selected tab replaces the last visible one when it doesn't fit
	let visible = tabs.slice(0, fitCount)
	const selectedIndex = tabs.findIndex((tab) => tab.value === value)
	if (selectedIndex >= fitCount) {
		visible = [...tabs.slice(0, Math.max(0, fitCount - 1)), tabs[selectedIndex]]
	}
	const hidden = tabs.filter((tab) => !visible.includes(tab))

	return (
		<div ref={containerRef} className={className}>
			<div ref={measureRef} aria-hidden className="invisible absolute h-0 overflow-hidden flex whitespace-nowrap">
				{tabs.map((tab) => (
					<span key={tab.value} className="inline-flex items-center gap-1.5 px-3 text-sm font-medium">
						{tab.label}
					</span>
				))}
			</div>
			<div className="flex items-center gap-1 min-w-0">
				<Tabs value={value} onValueChange={onChange} className="min-w-0">
					<TabsList className="h-10 p-1 max-w-full justify-start">
						{visible.map((tab) => (
							<TabsTrigger key={tab.value} value={tab.value} className="gap-1.5" title={tab.title}>
								{tab.label}
							</TabsTrigger>
						))}
					</TabsList>
				</Tabs>
				{hidden.length > 0 && (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" size="sm" className="h-10 shrink-0 gap-1 tabular-nums" aria-label={t`More`}>
								+{hidden.length}
								<ChevronDownIcon className="size-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
							<DropdownMenuRadioGroup value={value} onValueChange={onChange}>
								{hidden.map((tab) => (
									<DropdownMenuRadioItem key={tab.value} value={tab.value} className="gap-1.5" title={tab.title}>
										{tab.label}
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
						</DropdownMenuContent>
					</DropdownMenu>
				)}
			</div>
		</div>
	)
}
