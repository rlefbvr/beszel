import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { CopyIcon, KeyRoundIcon, LoaderCircleIcon, MailIcon, ShieldCheckIcon, ShieldOffIcon, SmartphoneIcon } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/otp"
import { Separator } from "@/components/ui/separator"
import { toast } from "@/components/ui/use-toast"
import { pb } from "@/lib/api"
import { copyToClipboard } from "@/lib/utils"

/** Second factor of the current user, from the hub */
interface MFAStatus {
	method: "" | "totp" | "email"
	/** unused recovery codes */
	recovery: number
	/** the hub can send emails */
	emailReady: boolean
	/** MFA_OTP: every user gets an email code */
	forAll: boolean
}

function errorToast(err: unknown) {
	toast({ variant: "destructive", title: t`Error`, description: (err as Error).message })
}

/** Security settings of the current user: the second factor asked after the password */
export default function SecuritySettings() {
	const [status, setStatus] = useState<MFAStatus>()
	const [dialog, setDialog] = useState<"totp" | "email" | "disable" | "recovery" | null>(null)

	const load = useCallback(async () => {
		try {
			setStatus(await pb.send<MFAStatus>("/api/beszel/mfa", {}))
		} catch (err) {
			errorToast(err)
		}
	}, [])
	useEffect(() => {
		load()
	}, [load])

	const recoveryLeft = status?.recovery ?? 0
	const close = () => {
		setDialog(null)
		load()
	}

	return (
		<div>
			<div>
				<h3 className="text-xl font-medium mb-2">
					<Trans>Security</Trans>
				</h3>
				<p className="text-sm text-muted-foreground leading-relaxed">
					<Trans>Protect your account with a second factor asked after the password.</Trans>
				</p>
			</div>
			<Separator className="my-4" />
			<div className="grid gap-4">
				<h3 className="text-lg font-medium flex items-center gap-2">
					<ShieldCheckIcon className="size-4" />
					<Trans>Two-factor authentication</Trans>
				</h3>
				{!status ? (
					<LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" />
				) : status.forAll ? (
					<p className="text-sm text-muted-foreground">
						<Trans>An email code is required from every user on this hub (MFA_OTP).</Trans>
					</p>
				) : (
					<>
						<div className="rounded-lg border px-4 py-3 text-sm flex items-center gap-3">
							{status.method === "totp" ? (
								<SmartphoneIcon className="size-5 text-green-600 dark:text-green-400" />
							) : status.method === "email" ? (
								<MailIcon className="size-5 text-green-600 dark:text-green-400" />
							) : (
								<ShieldOffIcon className="size-5 text-muted-foreground" />
							)}
							<div className="grid gap-0.5">
								<span className="font-medium">
									{status.method === "totp" ? (
										<Trans>Authenticator app</Trans>
									) : status.method === "email" ? (
										<Trans>Code sent by email</Trans>
									) : (
										<Trans>Not enabled</Trans>
									)}
								</span>
								{status.method === "totp" && (
									<span className="text-muted-foreground">
										<Trans>Recovery codes left: {recoveryLeft}</Trans>
									</span>
								)}
							</div>
						</div>
						<div className="flex flex-wrap gap-2">
							{status.method !== "totp" && (
								<Button variant="outline" className="gap-2" onClick={() => setDialog("totp")}>
									<SmartphoneIcon className="size-4" />
									<Trans>Use an authenticator app</Trans>
								</Button>
							)}
							{status.method !== "email" && (
								<Button
									variant="outline"
									className="gap-2"
									onClick={() => setDialog("email")}
									disabled={!status.emailReady}
									title={status.emailReady ? undefined : t`Email sending is not configured on the hub.`}
								>
									<MailIcon className="size-4" />
									<Trans>Use a code by email</Trans>
								</Button>
							)}
							{status.method === "totp" && (
								<Button variant="outline" className="gap-2" onClick={() => setDialog("recovery")}>
									<KeyRoundIcon className="size-4" />
									<Trans>New recovery codes</Trans>
								</Button>
							)}
							{status.method && (
								<Button variant="outline" className="gap-2" onClick={() => setDialog("disable")}>
									<ShieldOffIcon className="size-4" />
									<Trans>Disable</Trans>
								</Button>
							)}
						</div>
						{!status.emailReady && status.method !== "email" && (
							<p className="text-xs text-muted-foreground">
								<Trans>The code by email needs the mail settings of the hub.</Trans>
							</p>
						)}
					</>
				)}
			</div>
			<Dialog open={!!dialog} onOpenChange={(open) => !open && close()}>
				{dialog === "totp" && <TotpSetupDialog onDone={close} />}
				{dialog === "email" && <EmailDialog onDone={close} />}
				{dialog === "disable" && <ProofDialog action="disable" totp={status?.method === "totp"} onDone={close} />}
				{dialog === "recovery" && <ProofDialog action="recovery" totp onDone={close} />}
			</Dialog>
		</div>
	)
}

/** Recovery codes shown once, to save */
function RecoveryCodes({ codes }: { codes: string[] }) {
	return (
		<div className="grid gap-3">
			<p className="text-sm">
				<Trans>
					Save these recovery codes: each one can replace a code of the app once, if you lose your phone. They are
					not shown again.
				</Trans>
			</p>
			<div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/40 p-3 font-mono text-sm">
				{codes.map((code) => (
					<span key={code}>{code}</span>
				))}
			</div>
			<Button variant="outline" className="gap-2 justify-self-start" onClick={() => copyToClipboard(codes.join("\n"))}>
				<CopyIcon className="size-4" />
				<Trans>Copy</Trans>
			</Button>
		</div>
	)
}

/** Enrollment of an authenticator app: QR code, first code, recovery codes */
function TotpSetupDialog({ onDone }: { onDone: () => void }) {
	const [setup, setSetup] = useState<{ secret: string; qr: string }>()
	const [code, setCode] = useState("")
	const [saving, setSaving] = useState(false)
	const [codes, setCodes] = useState<string[]>()

	useEffect(() => {
		pb.send<{ secret: string; qr: string }>("/api/beszel/mfa/totp/setup", { method: "POST" }).then(setSetup, errorToast)
	}, [])

	async function enable(value: string) {
		setSaving(true)
		try {
			const res = await pb.send<{ recoveryCodes: string[] }>("/api/beszel/mfa/totp/enable", {
				method: "POST",
				body: { code: value },
			})
			setCodes(res.recoveryCodes)
		} catch (err) {
			setCode("")
			errorToast(err)
		} finally {
			setSaving(false)
		}
	}

	return (
		<DialogContent className="max-w-md">
			<DialogHeader>
				<DialogTitle>
					<Trans>Authenticator app</Trans>
				</DialogTitle>
				<DialogDescription>
					<Trans>
						Scan the QR code with an app such as Microsoft Authenticator or Google Authenticator, then enter the code
						it shows.
					</Trans>
				</DialogDescription>
			</DialogHeader>
			{codes ? (
				<>
					<RecoveryCodes codes={codes} />
					<DialogFooter>
						<Button onClick={onDone}>
							<Trans>Done</Trans>
						</Button>
					</DialogFooter>
				</>
			) : !setup ? (
				<LoaderCircleIcon className="size-6 animate-spin mx-auto text-muted-foreground" />
			) : (
				<div className="grid gap-4 justify-items-center">
					<img src={setup.qr} alt="" className="size-48 rounded bg-white p-2 [image-rendering:pixelated]" />
					<div className="grid gap-1 text-center">
						<span className="text-xs text-muted-foreground">
							<Trans>Or enter this key in the app:</Trans>
						</span>
						<code className="font-mono text-sm break-all select-all">{setup.secret.match(/.{1,4}/g)?.join(" ")}</code>
					</div>
					<InputOTP
						maxLength={6}
						value={code}
						onChange={(next) => {
							setCode(next)
							if (next.length === 6) {
								enable(next)
							}
						}}
						disabled={saving}
						autoFocus
					>
						<InputOTPGroup>
							{Array.from({ length: 6 }).map((_, i) => (
								<InputOTPSlot key={i} index={i} />
							))}
						</InputOTPGroup>
					</InputOTP>
				</div>
			)}
		</DialogContent>
	)
}

/** Confirms the code sent by email as second factor */
function EmailDialog({ onDone }: { onDone: () => void }) {
	const [saving, setSaving] = useState(false)
	async function enable() {
		setSaving(true)
		try {
			await pb.send("/api/beszel/mfa/email/enable", { method: "POST" })
			onDone()
		} catch (err) {
			errorToast(err)
		} finally {
			setSaving(false)
		}
	}
	return (
		<DialogContent className="max-w-md">
			<DialogHeader>
				<DialogTitle>
					<Trans>Code sent by email</Trans>
				</DialogTitle>
				<DialogDescription>
					<Trans>
						After your password, a code is sent to your email address at each login. It replaces the authenticator
						app if you used one.
					</Trans>
				</DialogDescription>
			</DialogHeader>
			<DialogFooter>
				<Button onClick={enable} disabled={saving} className="gap-2">
					{saving && <LoaderCircleIcon className="size-4 animate-spin" />}
					<Trans>Enable</Trans>
				</Button>
			</DialogFooter>
		</DialogContent>
	)
}

/** Asks the password (or a code of the app) to disable the second factor or renew the recovery codes */
function ProofDialog({ action, totp, onDone }: { action: "disable" | "recovery"; totp: boolean; onDone: () => void }) {
	const [password, setPassword] = useState("")
	const [code, setCode] = useState("")
	const [saving, setSaving] = useState(false)
	const [codes, setCodes] = useState<string[]>()

	async function submit(e: React.FormEvent) {
		e.preventDefault()
		setSaving(true)
		try {
			const res = await pb.send<{ recoveryCodes?: string[] }>(`/api/beszel/mfa/${action}`, {
				method: "POST",
				body: { password, code },
			})
			if (res.recoveryCodes) {
				setCodes(res.recoveryCodes)
			} else {
				onDone()
			}
		} catch (err) {
			errorToast(err)
		} finally {
			setSaving(false)
		}
	}

	return (
		<DialogContent className="max-w-md">
			<DialogHeader>
				<DialogTitle>
					{action === "disable" ? (
						<Trans>Disable two-factor authentication</Trans>
					) : (
						<Trans>New recovery codes</Trans>
					)}
				</DialogTitle>
				<DialogDescription>
					{totp ? (
						<Trans>Confirm with your password or a code of your authenticator app.</Trans>
					) : (
						<Trans>Confirm with your password.</Trans>
					)}
				</DialogDescription>
			</DialogHeader>
			{codes ? (
				<>
					<RecoveryCodes codes={codes} />
					<DialogFooter>
						<Button onClick={onDone}>
							<Trans>Done</Trans>
						</Button>
					</DialogFooter>
				</>
			) : (
				<form onSubmit={submit} className="grid gap-4">
					<div className="grid gap-2">
						<Label htmlFor="mfa-password">
							<Trans>Password</Trans>
						</Label>
						<Input
							id="mfa-password"
							type="password"
							autoComplete="current-password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
						/>
					</div>
					{totp && (
						<div className="grid gap-2">
							<Label htmlFor="mfa-code">
								<Trans>Or code of the app</Trans>
							</Label>
							<Input
								id="mfa-code"
								inputMode="numeric"
								autoComplete="one-time-code"
								maxLength={6}
								value={code}
								onChange={(e) => setCode(e.target.value)}
							/>
						</div>
					)}
					<DialogFooter>
						<Button type="submit" disabled={saving || (!password && !code)} className="gap-2">
							{saving && <LoaderCircleIcon className="size-4 animate-spin" />}
							{action === "disable" ? <Trans>Disable</Trans> : <Trans>Confirm</Trans>}
						</Button>
					</DialogFooter>
				</form>
			)}
		</DialogContent>
	)
}
