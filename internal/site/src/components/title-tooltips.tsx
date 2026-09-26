import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

/** Wait before showing a tooltip, like the other tooltips of the site */
const showDelay = 300
/** Space between the element and its tooltip, and to the edges of the window */
const gap = 6
const margin = 8

/**
 * Shows the title of the elements of the site in a tooltip styled like the
 * others, instead of the tooltip of the browser: the title is moved aside
 * while the element is hovered, then put back.
 */
export function TitleTooltips() {
	const [tip, setTip] = useState<{ text: string; rect: DOMRect } | null>(null)

	useEffect(() => {
		let current: HTMLElement | SVGElement | null = null
		let timer: ReturnType<typeof setTimeout> | undefined

		const restore = () => {
			clearTimeout(timer)
			if (current) {
				const text = current.dataset.nativeTitle
				if (text !== undefined) {
					current.setAttribute("title", text)
					delete current.dataset.nativeTitle
				}
				current = null
			}
			setTip(null)
		}

		const onOver = (e: MouseEvent) => {
			const target = e.target as Element | null
			const element = target?.closest?.("[title], [data-native-title]") as HTMLElement | SVGElement | null
			if (!element || element === current) {
				return
			}
			restore()
			const text = element.getAttribute("title") ?? ""
			if (!text.trim()) {
				return
			}
			element.dataset.nativeTitle = text
			element.removeAttribute("title")
			current = element
			timer = setTimeout(() => {
				if (current === element && element.isConnected) {
					setTip({ text, rect: element.getBoundingClientRect() })
				}
			}, showDelay)
		}

		const onOut = (e: MouseEvent) => {
			if (current && !current.contains(e.relatedTarget as Node | null)) {
				restore()
			}
		}

		document.addEventListener("mouseover", onOver)
		document.addEventListener("mouseout", onOut)
		document.addEventListener("mousedown", restore, true)
		window.addEventListener("scroll", restore, true)
		window.addEventListener("blur", restore)
		return () => {
			restore()
			document.removeEventListener("mouseover", onOver)
			document.removeEventListener("mouseout", onOut)
			document.removeEventListener("mousedown", restore, true)
			window.removeEventListener("scroll", restore, true)
			window.removeEventListener("blur", restore)
		}
	}, [])

	if (!tip) {
		return null
	}
	return createPortal(<TitleTooltip text={tip.text} rect={tip.rect} />, document.body)
}

/** The tooltip, under the element or above it near the bottom of the window, kept in the window */
function TitleTooltip({ text, rect }: { text: string; rect: DOMRect }) {
	const ref = useRef<HTMLDivElement>(null)
	const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

	useLayoutEffect(() => {
		const tooltip = ref.current
		if (!tooltip) {
			return
		}
		const { width, height } = tooltip.getBoundingClientRect()
		const below = rect.bottom + gap + height <= window.innerHeight - margin
		const top = below ? rect.bottom + gap : Math.max(margin, rect.top - gap - height)
		const center = rect.left + rect.width / 2
		const left = Math.min(Math.max(margin, center - width / 2), window.innerWidth - width - margin)
		setPosition({ top, left })
	}, [text, rect])

	return (
		<div
			ref={ref}
			role="tooltip"
			style={{ top: position?.top ?? -1000, left: position?.left ?? -1000 }}
			className="bg-popover text-popover-foreground border pointer-events-none fixed z-[100] w-fit max-w-[min(28rem,calc(100vw-1rem))] rounded-md px-3 py-1.5 text-sm break-words whitespace-pre-line shadow-md animate-in fade-in-0 zoom-in-95"
		>
			{text}
		</div>
	)
}
