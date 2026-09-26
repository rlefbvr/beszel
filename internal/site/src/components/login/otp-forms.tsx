import { Trans } from "@lingui/react/macro"
import { LoaderCircle, MailIcon, SendHorizonalIcon } from "lucide-react"
import { useCallback, useState } from "react"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/otp"
import { pb } from "@/lib/api"
import { $authenticated } from "@/lib/stores"
import { cn } from "@/lib/utils"
import { $router } from "../router"
import { buttonVariants } from "../ui/button"
import { Input } from "../ui/input"
import { Label } from "../ui/label"
import { showLoginFaliedToast } from "./auth-form"

export function OtpInputForm({ otpId, mfaId }: { otpId: string; mfaId: string }) {
	const [value, setValue] = useState("")

	if (value.length === 6) {
		pb.collection("users")
			.authWithOTP(otpId, value, { mfaId })
			.then(() => {
				$router.open("/")
				$authenticated.set(true)
			})
			.catch((err) => {
				showLoginFaliedToast(err.message)
			})
	}

	return (
		<div className="grid gap-3 items-center justify-center">
			<InputOTP maxLength={6} value={value} onChange={setValue} autoFocus>
				<InputOTPGroup>
					{Array.from({ length: 6 }).map((_, i) => (
						<InputOTPSlot key={i} index={i} />
					))}
				</InputOTPGroup>
			</InputOTP>
			<div className="text-center text-sm text-muted-foreground">
				<Trans>Enter your one-time password.</Trans>
			</div>
		</div>
	)
}

/** Code of the authenticator app of the user, or one of their recovery codes */
export function TotpInputForm({ mfaId }: { mfaId: string }) {
	const [value, setValue] = useState("")
	const [recovery, setRecovery] = useState(false)
	const [loading, setLoading] = useState(false)

	const submit = async (code: string) => {
		setLoading(true)
		try {
			const res = await pb.send<{ token: string; record: any }>("/api/beszel/auth-with-totp", {
				method: "POST",
				query: { mfaId },
				body: { mfaId, code },
			})
			pb.authStore.save(res.token, res.record)
			$router.open("/")
			$authenticated.set(true)
		} catch (err) {
			setValue("")
			showLoginFaliedToast((err as Error).message)
		} finally {
			setLoading(false)
		}
	}

	if (recovery) {
		return (
			<form
				className="grid gap-3"
				onSubmit={(e) => {
					e.preventDefault()
					submit(value)
				}}
			>
				<Label htmlFor="recovery-code" className="sr-only">
					<Trans>Recovery code</Trans>
				</Label>
				<Input
					id="recovery-code"
					value={value}
					onChange={(e) => setValue(e.target.value)}
					placeholder="xxxxx-xxxxx"
					autoComplete="one-time-code"
					className="font-mono text-center"
					autoFocus
					required
				/>
				<button type="submit" className={cn(buttonVariants())} disabled={loading}>
					{loading && <LoaderCircle className="me-2 h-4 w-4 animate-spin" />}
					<Trans>Sign in</Trans>
				</button>
				<div className="text-center text-sm text-muted-foreground">
					<Trans>Enter one of the recovery codes saved when setting up the app.</Trans>
				</div>
			</form>
		)
	}

	return (
		<div className="grid gap-3 items-center justify-center">
			<InputOTP
				maxLength={6}
				value={value}
				onChange={(next) => {
					setValue(next)
					if (next.length === 6) {
						submit(next)
					}
				}}
				disabled={loading}
				autoFocus
			>
				<InputOTPGroup>
					{Array.from({ length: 6 }).map((_, i) => (
						<InputOTPSlot key={i} index={i} />
					))}
				</InputOTPGroup>
			</InputOTP>
			<div className="text-center text-sm text-muted-foreground">
				<Trans>Enter the code of your authenticator app.</Trans>
			</div>
			<button
				type="button"
				className="text-sm text-muted-foreground underline-offset-4 hover:underline"
				onClick={() => {
					setValue("")
					setRecovery(true)
				}}
			>
				<Trans>Use a recovery code</Trans>
			</button>
		</div>
	)
}

export function OtpRequestForm() {
	const [isLoading, setIsLoading] = useState<boolean>(false)
	const [email, setEmail] = useState("")
	const [otpId, setOtpId] = useState<string | undefined>()

	const handleSubmit = useCallback(
		async (e: React.FormEvent<HTMLFormElement>) => {
			e.preventDefault()
			setIsLoading(true)
			try {
				// console.log(email)
				const { otpId } = await pb.collection("users").requestOTP(email)
				setOtpId(otpId)
			} catch (e: any) {
				showLoginFaliedToast(e?.message)
			} finally {
				setIsLoading(false)
				setEmail("")
			}
		},
		[email]
	)

	if (otpId) {
		return <OtpInputForm otpId={otpId} mfaId={""} />
	}

	return (
		<form onSubmit={handleSubmit}>
			<div className="grid gap-3">
				<div className="grid gap-1 relative">
					<MailIcon className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
					<Label className="sr-only" htmlFor="email">
						<Trans>Email</Trans>
					</Label>
					<Input
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						id="email"
						name="email"
						required
						placeholder="name@example.com"
						type="email"
						autoCapitalize="none"
						autoComplete="email"
						autoCorrect="off"
						disabled={isLoading}
						className="ps-9"
					/>
				</div>
				<button className={cn(buttonVariants())} disabled={isLoading}>
					{isLoading ? (
						<LoaderCircle className="me-2 h-4 w-4 animate-spin" />
					) : (
						<SendHorizonalIcon className="me-2 h-4 w-4" />
					)}
					<Trans>Request OTP</Trans>
				</button>
			</div>
		</form>
	)
}
