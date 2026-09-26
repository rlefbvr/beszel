import { Trans } from "@lingui/react/macro"
import { type ReactNode, useEffect, useRef, useState } from "react"
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Dialog } from "@/components/ui/dialog"
import { Sheet } from "@/components/ui/sheet"

/**
 * Dialog or sheet of a form that asks before closing when something was typed
 * in it: a click outside, Escape or the close button no longer lose the input.
 * The buttons of the form (cancel, save) close it as before.
 */
export function GuardedDialog({
	open,
	onOpenChange,
	sheet = false,
	children,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	/** a side sheet instead of a dialog */
	sheet?: boolean
	children: ReactNode
}) {
	const dirty = useRef(false)
	const [asking, setAsking] = useState(false)
	useEffect(() => {
		if (open) {
			dirty.current = false
		}
	}, [open])
	const Root = sheet ? Sheet : Dialog

	return (
		// events of the portal content go up the React tree to this wrapper
		<span
			className="contents"
			onInputCapture={() => {
				dirty.current = true
			}}
		>
			<Root
				open={open}
				onOpenChange={(next) => {
					if (!next && dirty.current) {
						setAsking(true)
						return
					}
					onOpenChange(next)
				}}
			>
				{children}
			</Root>
			<AlertDialog open={asking} onOpenChange={setAsking}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							<Trans>Do you really want to cancel your input?</Trans>
						</AlertDialogTitle>
						<AlertDialogDescription>
							<Trans>What you typed will be lost.</Trans>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>
							<Trans>Keep editing</Trans>
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								dirty.current = false
								setAsking(false)
								onOpenChange(false)
							}}
						>
							<Trans>Discard</Trans>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</span>
	)
}
