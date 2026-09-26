/** biome-ignore-all lint/correctness/useUniqueElementIds: component is only rendered once */
import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { redirectPage } from "@nanostores/router"
import {
	Building2Icon,
	CheckCircle2Icon,
	LoaderCircleIcon,
	PlugZapIcon,
	SaveIcon,
	UserCheckIcon,
	XCircleIcon,
} from "lucide-react"
import { useEffect, useState } from "react"
import { $router } from "@/components/router"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { toast } from "@/components/ui/use-toast"
import { isAdmin, pb } from "@/lib/api"

/** Settings of the directory, as the hub returns them (without the bind password) */
interface LDAPConfig {
	enabled: boolean
	url: string
	start_tls: boolean
	skip_verify: boolean
	bind_dn: string
	bind_password?: string
	base_dn: string
	user_filter: string
	email_attribute: string
	admin_group: string
	users_group: string
	readonly_group: string
	create_users: boolean
}

/** Result of a test of the settings */
interface TestResult {
	status?: string
	error?: string
	user?: { dn: string; email: string; name: string; role: string }
}

function Field({
	id,
	label,
	hint,
	children,
}: {
	id: string
	label: React.ReactNode
	hint?: React.ReactNode
	children: React.ReactNode
}) {
	return (
		<div className="grid gap-1.5">
			<Label htmlFor={id}>{label}</Label>
			{children}
			{hint && <p className="text-xs text-muted-foreground">{hint}</p>}
		</div>
	)
}

/** Login with an LDAP directory (Active Directory), for the admins */
export default function LdapSettings() {
	const [config, setConfig] = useState<LDAPConfig>()
	const [hasPassword, setHasPassword] = useState(false)
	const [saving, setSaving] = useState(false)
	const [testing, setTesting] = useState<"bind" | "user" | null>(null)
	const [result, setResult] = useState<TestResult>()
	const [testUser, setTestUser] = useState({ username: "", password: "" })

	useEffect(() => {
		if (!isAdmin()) {
			redirectPage($router, "settings", { name: "general" })
			return
		}
		pb.send<{ config: LDAPConfig; hasPassword: boolean }>("/api/beszel/ldap/config", {}).then(
			(res) => {
				setConfig(res.config)
				setHasPassword(res.hasPassword)
			},
			(err) => toast({ variant: "destructive", title: t`Error`, description: (err as Error).message })
		)
	}, [])

	if (!config) {
		return <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" />
	}

	const set = <K extends keyof LDAPConfig>(key: K, value: LDAPConfig[K]) => setConfig({ ...config, [key]: value })
	const text = (key: keyof LDAPConfig) => ({
		id: `ldap-${key}`,
		value: String(config[key] ?? ""),
		onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(key, e.target.value as never),
		spellCheck: false,
	})

	async function save(e: React.FormEvent) {
		e.preventDefault()
		setSaving(true)
		try {
			const res = await pb.send<{ config: LDAPConfig; hasPassword: boolean }>("/api/beszel/ldap/config", {
				method: "POST",
				body: config,
			})
			setConfig(res.config)
			setHasPassword(res.hasPassword)
			toast({ title: t`Settings saved` })
		} catch (err) {
			toast({ variant: "destructive", title: t`Error`, description: (err as Error).message })
		} finally {
			setSaving(false)
		}
	}

	async function test(kind: "bind" | "user") {
		setTesting(kind)
		setResult(undefined)
		try {
			const body =
				kind === "user" ? { ...config, test_username: testUser.username, test_password: testUser.password } : config
			setResult(await pb.send<TestResult>("/api/beszel/ldap/test", { method: "POST", body }))
		} catch (err) {
			setResult({ error: (err as Error).message })
		} finally {
			setTesting(null)
		}
	}

	const roleLabels: Record<string, () => string> = {
		admin: () => t`Admin`,
		user: () => t`User`,
		readonly: () => t`Read only`,
	}

	return (
		<div>
			<div>
				<h3 className="text-xl font-medium mb-2 flex items-center gap-2">
					<Building2Icon className="size-5" />
					<Trans>Directory (LDAP)</Trans>
				</h3>
				<p className="text-sm text-muted-foreground leading-relaxed">
					<Trans>
						Let the users log in with their account of an LDAP directory such as Active Directory. Their role follows
						their groups; the second factor of each user still applies.
					</Trans>
				</p>
			</div>
			<Separator className="my-4" />
			<form onSubmit={save} className="grid gap-5">
				<label className="flex items-center gap-2 text-sm font-medium">
					<Checkbox checked={config.enabled} onCheckedChange={(checked) => set("enabled", checked === true)} />
					<Trans>Enable the login with the directory</Trans>
				</label>

				<div className="grid sm:grid-cols-2 gap-4">
					<Field
						id="ldap-url"
						label={<Trans>Server URL</Trans>}
						hint={<Trans>ldaps://dc.example.com:636, or ldap://dc.example.com:389 with StartTLS.</Trans>}
					>
						<Input {...text("url")} placeholder="ldaps://dc.example.com:636" />
					</Field>
					<div className="grid gap-2 content-center">
						<label className="flex items-center gap-2 text-sm">
							<Checkbox checked={config.start_tls} onCheckedChange={(checked) => set("start_tls", checked === true)} />
							StartTLS
						</label>
						<label className="flex items-center gap-2 text-sm">
							<Checkbox
								checked={config.skip_verify}
								onCheckedChange={(checked) => set("skip_verify", checked === true)}
							/>
							<Trans>Do not check the certificate of the server</Trans>
						</label>
					</div>
					<Field
						id="ldap-bind_dn"
						label={<Trans>Service account</Trans>}
						hint={<Trans>Distinguished name or user@domain of the account searching the users.</Trans>}
					>
						<Input {...text("bind_dn")} placeholder="CN=svc-beszel,OU=Services,DC=example,DC=com" />
					</Field>
					<Field
						id="ldap-bind_password"
						label={<Trans>Password of the service account</Trans>}
						hint={hasPassword ? <Trans>Saved. Leave empty to keep it.</Trans> : undefined}
					>
						<Input {...text("bind_password")} type="password" autoComplete="new-password" />
					</Field>
					<Field id="ldap-base_dn" label={<Trans>Search base</Trans>}>
						<Input {...text("base_dn")} placeholder="DC=example,DC=com" />
					</Field>
					<Field id="ldap-email_attribute" label={<Trans>Email attribute</Trans>}>
						<Input {...text("email_attribute")} placeholder="mail" />
					</Field>
					<div className="sm:col-span-2">
						<Field
							id="ldap-user_filter"
							label={<Trans>User filter</Trans>}
							hint={
								<>
									<Trans>This placeholder is replaced by the name typed at the login:</Trans>{" "}
									<code className="font-mono">{"{username}"}</code>
								</>
							}
						>
							<Input {...text("user_filter")} className="font-mono text-xs" />
						</Field>
					</div>
				</div>

				<div className="grid gap-4">
					<h4 className="font-medium">
						<Trans>Groups and roles</Trans>
					</h4>
					<div className="grid sm:grid-cols-3 gap-4">
						<Field id="ldap-admin_group" label={<Trans>Admins group</Trans>}>
							<Input {...text("admin_group")} placeholder="CN=Beszel Admins,OU=Groups,DC=example,DC=com" />
						</Field>
						<Field
							id="ldap-users_group"
							label={<Trans>Users group</Trans>}
							hint={<Trans>When set, the other accounts can't log in.</Trans>}
						>
							<Input {...text("users_group")} />
						</Field>
						<Field id="ldap-readonly_group" label={<Trans>Read-only group</Trans>}>
							<Input {...text("readonly_group")} />
						</Field>
					</div>
					<label className="flex items-center gap-2 text-sm">
						<Checkbox
							checked={config.create_users}
							onCheckedChange={(checked) => set("create_users", checked === true)}
						/>
						<Trans>Create the users at their first login (otherwise, only the existing users of the same email)</Trans>
					</label>
				</div>

				<Separator />
				<div className="grid gap-3">
					<h4 className="font-medium">
						<Trans>Test</Trans>
					</h4>
					<div className="grid sm:grid-cols-[1fr_1fr_auto_auto] gap-2 items-end">
						<Input
							value={testUser.username}
							onChange={(e) => setTestUser({ ...testUser, username: e.target.value })}
							placeholder={t`Username to test (optional)`}
							autoComplete="off"
						/>
						<Input
							type="password"
							value={testUser.password}
							onChange={(e) => setTestUser({ ...testUser, password: e.target.value })}
							placeholder={t`Password`}
							autoComplete="new-password"
						/>
						<Button type="button" variant="outline" className="gap-2" onClick={() => test("bind")} disabled={!!testing}>
							{testing === "bind" ? (
								<LoaderCircleIcon className="size-4 animate-spin" />
							) : (
								<PlugZapIcon className="size-4" />
							)}
							<Trans>Test the connection</Trans>
						</Button>
						<Button
							type="button"
							variant="outline"
							className="gap-2"
							onClick={() => test("user")}
							disabled={!!testing || !testUser.username || !testUser.password}
						>
							{testing === "user" ? (
								<LoaderCircleIcon className="size-4 animate-spin" />
							) : (
								<UserCheckIcon className="size-4" />
							)}
							<Trans>Test the login</Trans>
						</Button>
					</div>
					{result && (
						<div
							className={
								result.error
									? "rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm flex gap-2"
									: "rounded-lg border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm flex gap-2"
							}
						>
							{result.error ? (
								<XCircleIcon className="size-4 shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
							) : (
								<CheckCircle2Icon className="size-4 shrink-0 mt-0.5 text-green-600 dark:text-green-400" />
							)}
							<div className="grid gap-0.5 min-w-0 break-words">
								<span className="font-medium">{result.error ?? <Trans>It works.</Trans>}</span>
								{result.user?.dn && <span className="text-muted-foreground font-mono text-xs">{result.user.dn}</span>}
								{result.user?.email && (
									<span className="text-muted-foreground">
										{result.user.email}
										{result.user.role && ` · ${roleLabels[result.user.role]?.() ?? result.user.role}`}
									</span>
								)}
							</div>
						</div>
					)}
				</div>

				<Separator />
				<Button type="submit" className="flex items-center gap-1.5 justify-self-start" disabled={saving}>
					{saving ? <LoaderCircleIcon className="h-4 w-4 animate-spin" /> : <SaveIcon className="h-4 w-4" />}
					<Trans>Save Settings</Trans>
				</Button>
			</form>
		</div>
	)
}
