/** biome-ignore-all lint/correctness/useUniqueElementIds: component is only rendered once */
import { Trans, useLingui } from "@lingui/react/macro"
import { DownloadIcon, GlobeIcon, LanguagesIcon, LoaderCircleIcon, SaveIcon, ServerCogIcon, WandSparklesIcon } from "lucide-react"
import { useState } from "react"
import { useStore } from "@nanostores/react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import Slider from "@/components/ui/slider"
import { toast } from "@/components/ui/use-toast"
import { isAdmin, queueUserSettings, saveAgentInstallDir, saveAgentServiceName, saveChartPeriods, saveServicesInterval } from "@/lib/api"
import { HourFormat, Unit } from "@/lib/enums"
import { dynamicActivate } from "@/lib/i18n"
import { $instance, saveInstance } from "@/lib/instance"
import languages from "@/lib/languages"
import { $agentInstallDir, $agentServiceName, $chartPeriods, $servicesInterval, $userSettings, defaultLayoutWidth } from "@/lib/stores"
import { chartTimeData, currentHour12, longChartPeriods, secondsToString } from "@/lib/utils"
import type { ChartTimes, UserSettings } from "@/types"
import { basePath } from "@/components/router"
import { type HomePage, homePages } from "@/lib/home-page"
import { saveSettings } from "./layout"

/** Allowed agent service names: safe in file names and shell commands */
const serviceNamePattern = /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,63}$/

/** Allowed Windows install folders: absolute paths safe in a PowerShell argument */
const installDirPattern = /^([A-Za-z]:\\[A-Za-z0-9 _.()\\-]*)?$/

/** Instance URLs: absolute http(s) URLs */
const instanceUrlPattern = /^https?:\/\/[^\s/]+(\/\S*)?$/

/** Name and URL of the instance guessed from the address of the page: "monitoring" in monitoring.example.com */
function guessInstance() {
	const { hostname, origin } = window.location
	const label = /^[\d.]+$|^\[|^localhost$/.test(hostname) ? hostname : hostname.split(".")[0]
	return {
		name: label.charAt(0).toUpperCase() + label.slice(1),
		url: `${origin}${basePath}`.replace(/\/+$/, ""),
	}
}

/** Service collection intervals offered in settings, in minutes */
const servicesIntervals = [1, 2, 5, 10, 15, 30, 60]

export default function SettingsProfilePage({ userSettings }: { userSettings: UserSettings }) {
	const [isLoading, setIsLoading] = useState(false)
	const { i18n, t } = useLingui()
	const currentUserSettings = useStore($userSettings)
	const layoutWidth = currentUserSettings.layoutWidth ?? defaultLayoutWidth
	const servicesInterval = useStore($servicesInterval)
	const [newServicesInterval, setNewServicesInterval] = useState<number>()
	const agentServiceName = useStore($agentServiceName)
	const [newAgentServiceName, setNewAgentServiceName] = useState<string>()
	const serviceNameInvalid = newAgentServiceName !== undefined && !serviceNamePattern.test(newAgentServiceName)
	const agentInstallDir = useStore($agentInstallDir)
	const [newAgentInstallDir, setNewAgentInstallDir] = useState<string>()
	const installDirInvalid = newAgentInstallDir !== undefined && !installDirPattern.test(newAgentInstallDir)
	const instance = useStore($instance)
	const chartPeriods = useStore($chartPeriods)
	const [newChartPeriods, setNewChartPeriods] = useState<ChartTimes[]>()
	const [newInstanceName, setNewInstanceName] = useState<string>()
	const [newInstanceUrl, setNewInstanceUrl] = useState<string>()
	const instanceUrlInvalid = !!newInstanceUrl && !instanceUrlPattern.test(newInstanceUrl.trim())

	async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault()
		setIsLoading(true)
		const formData = new FormData(e.target as HTMLFormElement)
		const data = Object.fromEntries(formData) as Partial<UserSettings>
		await saveSettings(data)
		const hubChanges: Promise<void>[] = []
		if (newServicesInterval && newServicesInterval !== servicesInterval) {
			hubChanges.push(saveServicesInterval(newServicesInterval))
		}
		if (newAgentServiceName && !serviceNameInvalid && newAgentServiceName !== agentServiceName) {
			hubChanges.push(saveAgentServiceName(newAgentServiceName))
		}
		if (newAgentInstallDir !== undefined && !installDirInvalid && newAgentInstallDir !== agentInstallDir) {
			hubChanges.push(saveAgentInstallDir(newAgentInstallDir))
		}
		if (newChartPeriods?.length && newChartPeriods.join() !== chartPeriods.join()) {
			hubChanges.push(saveChartPeriods(newChartPeriods))
		}
		const instanceName = newInstanceName ?? instance.name
		const instanceUrl = newInstanceUrl ?? instance.url
		if (!instanceUrlInvalid && (instanceName !== instance.name || instanceUrl !== instance.url)) {
			hubChanges.push(saveInstance(instanceName, instanceUrl))
		}
		if (hubChanges.length) {
			try {
				await Promise.all(hubChanges)
			} catch (e) {
				console.error("save hub settings", e)
				toast({
					title: t`Failed to save settings`,
					description: t`Check logs for more details.`,
					variant: "destructive",
				})
			}
		}
		setIsLoading(false)
	}

	return (
		<div>
			<div>
				<h3 className="text-xl font-medium mb-2">
					<Trans>General</Trans>
				</h3>
				<p className="text-sm text-muted-foreground leading-relaxed">
					<Trans>Change general application options.</Trans>
				</p>
			</div>
			<Separator className="my-4" />
			<form onSubmit={handleSubmit} className="space-y-5">
				<div className="grid gap-2">
					<div className="mb-2">
						<h3 className="mb-1 text-lg font-medium flex items-center gap-2">
							<GlobeIcon className="h-4 w-4" />
							<Trans>Instance</Trans>
						</h3>
						<p className="text-sm text-muted-foreground leading-relaxed">
							<Trans>Name and default URL of this hub, used in notification links and shown in the interface.</Trans>
						</p>
					</div>
					<div className="grid sm:grid-cols-[1fr_1.5fr_auto] gap-4 items-end">
						<div className="grid gap-2">
							<Label htmlFor="instanceName">
								<Trans>Instance name</Trans>
							</Label>
							<Input
								id="instanceName"
								value={newInstanceName ?? instance.name}
								onChange={(e) => setNewInstanceName(e.target.value)}
								maxLength={100}
								disabled={!isAdmin()}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="instanceUrl">
								<Trans>Default URL</Trans>
							</Label>
							<Input
								id="instanceUrl"
								type="url"
								placeholder="https://monitoring.example.com"
								value={newInstanceUrl ?? instance.url}
								onChange={(e) => setNewInstanceUrl(e.target.value)}
								disabled={!isAdmin() || instance.urlFromEnv}
								aria-invalid={instanceUrlInvalid}
							/>
						</div>
						{isAdmin() && (
							<Button
								type="button"
								variant="outline"
								className="gap-2"
								onClick={() => {
									const guess = guessInstance()
									setNewInstanceName(guess.name)
									if (!instance.urlFromEnv) {
										setNewInstanceUrl(guess.url)
									}
								}}
							>
								<WandSparklesIcon className="size-4" />
								<Trans>Detect</Trans>
							</Button>
						)}
					</div>
					{instance.urlFromEnv && (
						<p className="text-xs text-muted-foreground">
							<Trans>The URL is set by the APP_URL environment variable of the hub.</Trans>
						</p>
					)}
					{instanceUrlInvalid && (
						<p className="text-xs text-destructive">
							<Trans>Use an absolute URL starting with http:// or https://.</Trans>
						</p>
					)}
					<div className="grid sm:grid-cols-2 gap-4 mt-2">
						<div className="grid gap-2">
							<Label className="block" htmlFor="tabTitle">
								<Trans>Browser tab title</Trans>
							</Label>
							<Select name="tabTitle" key={userSettings.tabTitle} defaultValue={userSettings.tabTitle ?? "beszel"}>
								<SelectTrigger id="tabTitle">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="beszel">Beszel</SelectItem>
									<SelectItem value="name">
										<Trans>Instance name</Trans>
									</SelectItem>
									<SelectItem value="url">
										<Trans>Default URL</Trans>
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="grid gap-2">
							<Label className="block" htmlFor="headerLabel">
								<Trans>Next to the logo</Trans>
							</Label>
							<Select name="headerLabel" key={userSettings.headerLabel} defaultValue={userSettings.headerLabel ?? "none"}>
								<SelectTrigger id="headerLabel">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="none">
										<Trans>Nothing</Trans>
									</SelectItem>
									<SelectItem value="name">
										<Trans>Instance name</Trans>
									</SelectItem>
									<SelectItem value="url">
										<Trans>Default URL</Trans>
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="grid gap-2">
							<Label className="block" htmlFor="homePage">
								<Trans>Home page</Trans>
							</Label>
							<Select name="homePage" key={userSettings.homePage} defaultValue={userSettings.homePage ?? "home"}>
								<SelectTrigger id="homePage">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{(Object.keys(homePages) as HomePage[]).map((page) => (
										<SelectItem key={page} value={page}>
											{homePages[page]()}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground">
								<Trans>Page opened at start and by the logo.</Trans>
							</p>
						</div>
					</div>
				</div>
				<Separator />
				<div className="grid gap-2">
					<div className="mb-2">
						<h3 className="mb-1 text-lg font-medium flex items-center gap-2">
							<LanguagesIcon className="h-4 w-4" />
							<Trans>Language</Trans>
						</h3>
						<p className="text-sm text-muted-foreground leading-relaxed">
							<Trans>
								Want to help improve our translations? Check{" "}
								<a href="https://crowdin.com/project/beszel" className="link" target="_blank" rel="noopener noreferrer">
									Crowdin
								</a>{" "}
								for details.
							</Trans>
						</p>
					</div>
					<Label className="block" htmlFor="lang">
						<Trans>Preferred Language</Trans>
					</Label>
					<Select
						name="lang"
						value={i18n.locale}
						onValueChange={(lang: string) => {
							dynamicActivate(lang)
							// saved right away: notifications sent by the hub use this language
							queueUserSettings({ lang })
						}}
					>
						<SelectTrigger id="lang">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{languages.map(([lang, label, e]) => (
								<SelectItem key={lang} value={lang}>
									<span className="me-2.5">
										{e || (
											<code
												aria-hidden="true"
												className="font-mono bg-muted text-[.65em] w-5 h-4 inline-grid place-items-center"
											>
												{lang}
											</code>
										)}
									</span>
									{label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<Separator />
				<div className="grid gap-2">
					<div className="mb-2">
						<h3 className="mb-1 text-lg font-medium">
							<Trans>Layout width</Trans>
						</h3>
						<Label htmlFor="layoutWidth" className="text-sm text-muted-foreground leading-relaxed">
							<Trans>Adjust the width of the main layout</Trans> ({layoutWidth}px)
						</Label>
					</div>
					<Slider
						id="layoutWidth"
						name="layoutWidth"
						value={[layoutWidth]}
						onValueChange={(val) => $userSettings.setKey("layoutWidth", val[0])}
						min={1000}
						max={2000}
						step={10}
						className="w-full mb-1"
					/>
				</div>
				<Separator />
				<div className="grid gap-2">
					<div className="mb-2">
						<h3 className="mb-1 text-lg font-medium">
							<Trans>Chart options</Trans>
						</h3>
						<p className="text-sm text-muted-foreground leading-relaxed">
							<Trans>Adjust display options for charts.</Trans>
						</p>
					</div>
					<div className="grid sm:grid-cols-3 gap-4">
						<div className="grid gap-2">
							<Label className="block" htmlFor="chartTime">
								<Trans>Default time period</Trans>
							</Label>
							<Select name="chartTime" key={userSettings.chartTime} defaultValue={userSettings.chartTime}>
								<SelectTrigger id="chartTime">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{Object.entries(chartTimeData)
										.filter(([value]) => chartPeriods.includes(value as ChartTimes))
										.map(([value, { label }]) => (
											<SelectItem key={value} value={value}>
												{label()}
											</SelectItem>
										))}
								</SelectContent>
							</Select>
						</div>
						<div className="grid gap-2">
							<Label className="block" htmlFor="hourFormat">
								<Trans>Time format</Trans>
							</Label>
							<Select
								name="hourFormat"
								key={userSettings.hourFormat}
								defaultValue={userSettings.hourFormat ?? (currentHour12() ? HourFormat["12h"] : HourFormat["24h"])}
							>
								<SelectTrigger id="hourFormat">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{Object.keys(HourFormat).map((value) => (
										<SelectItem key={value} value={value}>
											{value}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
				</div>
				{isAdmin() && (
					<ChartPeriods
						value={newChartPeriods ?? chartPeriods}
						onChange={setNewChartPeriods}
					/>
				)}
				<Separator />
				<div className="grid gap-2">
					<div className="mb-2">
						<h3 className="mb-1 text-lg font-medium">
							<Trans comment="Temperature / network units">Unit preferences</Trans>
						</h3>
						<p className="text-sm text-muted-foreground leading-relaxed">
							<Trans>Change display units for metrics.</Trans>
						</p>
					</div>
					<div className="grid sm:grid-cols-3 gap-4">
						<div className="grid gap-2">
							<Label className="block" htmlFor="unitTemp">
								<Trans>Temperature unit</Trans>
							</Label>
							<Select
								name="unitTemp"
								key={userSettings.unitTemp}
								defaultValue={userSettings.unitTemp?.toString() || String(Unit.Celsius)}
							>
								<SelectTrigger id="unitTemp">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={String(Unit.Celsius)}>
										<Trans>Celsius (°C)</Trans>
									</SelectItem>
									<SelectItem value={String(Unit.Fahrenheit)}>
										<Trans>Fahrenheit (°F)</Trans>
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="grid gap-2">
							<Label className="block" htmlFor="unitNet">
								<Trans comment="Context: Bytes or bits">Network unit</Trans>
							</Label>
							<Select
								name="unitNet"
								key={userSettings.unitNet}
								defaultValue={userSettings.unitNet?.toString() ?? String(Unit.Bytes)}
							>
								<SelectTrigger id="unitNet">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={String(Unit.Bytes)}>
										<Trans>Bytes (KB/s, MB/s, GB/s)</Trans>
									</SelectItem>
									<SelectItem value={String(Unit.Bits)}>
										<Trans>Bits (Kbps, Mbps, Gbps)</Trans>
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="grid gap-2">
							<Label className="block" htmlFor="unitDisk">
								<Trans>Disk unit</Trans>
							</Label>
							<Select
								name="unitDisk"
								key={userSettings.unitDisk}
								defaultValue={userSettings.unitDisk?.toString() ?? String(Unit.Bytes)}
							>
								<SelectTrigger id="unitDisk">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={String(Unit.Bytes)}>
										<Trans>Bytes (KB/s, MB/s, GB/s)</Trans>
									</SelectItem>
									<SelectItem value={String(Unit.Bits)}>
										<Trans>Bits (Kbps, Mbps, Gbps)</Trans>
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>
				</div>
				<Separator />
				<div className="grid gap-2">
					<div className="mb-2">
						<h3 className="mb-1 text-lg font-medium">
							<Trans>Warning thresholds</Trans>
						</h3>
						<p className="text-sm text-muted-foreground leading-relaxed">
							<Trans>Set percentage thresholds for meter colors.</Trans>
						</p>
					</div>
					<div className="grid grid-cols-2 lg:grid-cols-3 gap-4 items-end">
						<div className="grid gap-2">
							<Label htmlFor="colorWarn">
								<Trans>Warning (%)</Trans>
							</Label>
							<Input
								id="colorWarn"
								name="colorWarn"
								type="number"
								min={1}
								max={100}
								className="min-w-24"
								defaultValue={userSettings.colorWarn ?? 65}
							/>
						</div>
						<div className="grid gap-1">
							<Label htmlFor="colorCrit">
								<Trans>Critical (%)</Trans>
							</Label>
							<Input
								id="colorCrit"
								name="colorCrit"
								type="number"
								min={1}
								max={100}
								className="min-w-24"
								defaultValue={userSettings.colorCrit ?? 90}
							/>
						</div>
					</div>
				</div>
				<Separator />
				<div className="grid gap-2">
					<div className="mb-2">
						<h3 className="mb-1 text-lg font-medium flex items-center gap-2">
							<ServerCogIcon className="h-4 w-4" />
							<Trans>Services</Trans>
						</h3>
						<p className="text-sm text-muted-foreground leading-relaxed">
							<Trans>
								How often agents collect systemd and Windows service data. Shorter intervals detect state changes
								sooner but write more data. Applies to all systems.
							</Trans>
						</p>
					</div>
					<div className="grid sm:grid-cols-3 gap-4">
						<div className="grid gap-2">
							<Label className="block" htmlFor="servicesInterval">
								<Trans>Collection interval</Trans>
							</Label>
							<Select
								key={servicesInterval}
								defaultValue={String(servicesInterval)}
								onValueChange={(value) => setNewServicesInterval(Number(value))}
								disabled={!isAdmin()}
							>
								<SelectTrigger id="servicesInterval">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{servicesIntervals.map((minutes) => (
										<SelectItem key={minutes} value={String(minutes)}>
											{secondsToString(minutes * 60, "minute")}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{!isAdmin() && (
								<p className="text-xs text-muted-foreground">
									<Trans>Only administrators can change this setting.</Trans>
								</p>
							)}
						</div>
					</div>
				</div>
				<Separator />
				<div className="grid gap-2">
					<div className="mb-2">
						<h3 className="mb-1 text-lg font-medium flex items-center gap-2">
							<DownloadIcon className="h-4 w-4" />
							<Trans>Agent installation</Trans>
						</h3>
						<p className="text-sm text-muted-foreground leading-relaxed">
							<Trans>
								Name of the service created when installing an agent with the Linux or Windows commands. Existing
								agents keep their service name.
							</Trans>
						</p>
					</div>
					<div className="grid sm:grid-cols-3 gap-4">
						<div className="grid gap-2">
							<Label className="block" htmlFor="agentServiceName">
								<Trans>Service name</Trans>
							</Label>
							<Input
								id="agentServiceName"
								key={agentServiceName}
								defaultValue={agentServiceName}
								onChange={(e) => setNewAgentServiceName(e.target.value.trim())}
								disabled={!isAdmin()}
								aria-invalid={serviceNameInvalid}
								maxLength={64}
								spellCheck={false}
							/>
							{serviceNameInvalid && (
								<p className="text-xs text-destructive">
									<Trans>Use letters, digits and _ . @ - only.</Trans>
								</p>
							)}
							{!isAdmin() && (
								<p className="text-xs text-muted-foreground">
									<Trans>Only administrators can change this setting.</Trans>
								</p>
							)}
						</div>
						<div className="grid gap-2 sm:col-span-2">
							<Label className="block" htmlFor="agentInstallDir">
								<Trans>Windows install folder</Trans>
							</Label>
							<Input
								id="agentInstallDir"
								key={agentInstallDir}
								defaultValue={agentInstallDir}
								placeholder="C:\Program Files\beszel-agent"
								onChange={(e) => setNewAgentInstallDir(e.target.value.trim())}
								disabled={!isAdmin()}
								aria-invalid={installDirInvalid}
								maxLength={200}
								spellCheck={false}
							/>
							{installDirInvalid && (
								<p className="text-xs text-destructive">
									<Trans>Use an absolute path such as C:\MONITORING, without special characters.</Trans>
								</p>
							)}
						</div>
					</div>
				</div>
				<Separator />
				<Button type="submit" className="flex items-center gap-1.5 disabled:opacity-100" disabled={isLoading}>
					{isLoading ? <LoaderCircleIcon className="h-4 w-4 animate-spin" /> : <SaveIcon className="h-4 w-4" />}
					<Trans>Save Settings</Trans>
				</Button>
			</form>
		</div>
	)
}

/** Chart periods offered to all users (admins); the long ones keep one record per day */
function ChartPeriods({ value, onChange }: { value: ChartTimes[]; onChange: (periods: ChartTimes[]) => void }) {
	const all = Object.keys(chartTimeData) as ChartTimes[]
	const toggle = (period: ChartTimes, checked: boolean) => {
		const next = all.filter((p) => (p === period ? checked : value.includes(p)))
		// at least one period stays offered
		if (next.length) {
			onChange(next)
		}
	}
	return (
		<>
			<Separator />
			<div className="grid gap-2">
				<div className="mb-2">
					<h3 className="mb-1 text-lg font-medium">
						<Trans>Chart periods</Trans>
					</h3>
					<p className="text-sm text-muted-foreground leading-relaxed">
						<Trans>
							Periods offered in the charts of all users. The periods of 90 days or more keep one record per day for
							that long, which uses more disk space.
						</Trans>
					</p>
				</div>
				<div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2.5">
					{all.map((period) => (
						<div key={period} className="flex items-center gap-2 text-sm">
							<Checkbox
								id={`chart-period-${period}`}
								checked={value.includes(period)}
								onCheckedChange={(checked) => toggle(period, checked === true)}
							/>
							<label htmlFor={`chart-period-${period}`} className="cursor-pointer">
								{chartTimeData[period].label()}
								{longChartPeriods.includes(period) && (
									<span className="ms-1.5 text-xs text-muted-foreground">
										<Trans>(daily data)</Trans>
									</span>
								)}
							</label>
						</div>
					))}
				</div>
			</div>
		</>
	)
}
