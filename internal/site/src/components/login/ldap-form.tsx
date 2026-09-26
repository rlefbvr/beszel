import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { ArrowLeftIcon, LoaderCircle, LockIcon, LogInIcon, UserIcon } from "lucide-react"
import { useState } from "react"
import { buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { pb } from "@/lib/api"
import { $authenticated } from "@/lib/stores"
import { cn } from "@/lib/utils"
import { showLoginFaliedToast } from "./auth-form"

/**
 * Login with an account of the directory (LDAP / Active Directory). A second
 * factor of the user is asked like after a password: onMfa gets the session.
 */
export function LdapLoginForm({ onBack, onMfa }: { onBack: () => void; onMfa: (mfaId: string) => void }) {
	const [loading, setLoading] = useState(false)

	async function submit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault()
		const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
		setLoading(true)
		try {
			const res = await pb.send<{ token: string; record: any }>("/api/beszel/auth-with-ldap", {
				method: "POST",
				body: { username: data.username, password: data.password },
			})
			pb.authStore.save(res.token, res.record)
			$authenticated.set(true)
		} catch (err: any) {
			const mfaId = err?.response?.mfaId
			if (mfaId) {
				onMfa(mfaId)
			} else {
				showLoginFaliedToast(err?.status === 429 ? err.message : undefined)
			}
		} finally {
			setLoading(false)
		}
	}

	return (
		<form onSubmit={submit} className="grid gap-2.5">
			<div className="grid gap-1 relative">
				<UserIcon className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
				<Label className="sr-only" htmlFor="ldap-username">
					<Trans>Directory account</Trans>
				</Label>
				<Input
					id="ldap-username"
					name="username"
					required
					placeholder={t`Username or email of the directory`}
					autoCapitalize="none"
					autoComplete="username"
					autoCorrect="off"
					disabled={loading}
					className="ps-9"
					autoFocus
				/>
			</div>
			<div className="grid gap-1 relative">
				<LockIcon className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
				<Label className="sr-only" htmlFor="ldap-password">
					<Trans>Password</Trans>
				</Label>
				<Input
					id="ldap-password"
					name="password"
					type="password"
					required
					placeholder={t`Password`}
					autoComplete="current-password"
					disabled={loading}
					className="ps-9"
				/>
			</div>
			<button className={cn(buttonVariants())} disabled={loading}>
				{loading ? <LoaderCircle className="me-2 h-4 w-4 animate-spin" /> : <LogInIcon className="me-2 h-4 w-4" />}
				<Trans>Sign in with the directory</Trans>
			</button>
			<button
				type="button"
				onClick={onBack}
				className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:underline"
			>
				<ArrowLeftIcon className="size-3.5" />
				<Trans>Back to the other logins</Trans>
			</button>
		</form>
	)
}
