/** biome-ignore-all lint/correctness/useUniqueElementIds: component is only rendered once */
import { Trans, useLingui } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import {
	LanguagesIcon,
	LoaderCircleIcon,
	MonitorIcon,
	MoonStarIcon,
	PanelTopIcon,
	PaletteIcon,
	SaveIcon,
	SunIcon,
	SunMoonIcon,
} from "lucide-react"
import { useState } from "react"
import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import Slider from "@/components/ui/slider"
import { queueUserSettings } from "@/lib/api"
import { type HeaderIcon, headerIcons } from "@/lib/header-icons"
import { type HomePage, homePages } from "@/lib/home-page"
import { dynamicActivate } from "@/lib/i18n"
import languages from "@/lib/languages"
import { $userSettings, defaultLayoutWidth } from "@/lib/stores"
import { cn } from "@/lib/utils"
import type { UserSettings } from "@/types"
import { saveSettings } from "./layout"

type Theme = NonNullable<UserSettings["theme"]>

const themes: { value: Theme; icon: typeof SunIcon; label: () => React.ReactNode }[] = [
	{ value: "light", icon: SunIcon, label: () => <Trans>Light</Trans> },
	{ value: "dark", icon: MoonStarIcon, label: () => <Trans>Dark</Trans> },
	{ value: "system", icon: SunMoonIcon, label: () => <Trans>System</Trans> },
]

/** Section title and description of the settings page */
function Section({
	icon: Icon,
	title,
	description,
	children,
}: {
	icon?: typeof SunIcon
	title: React.ReactNode
	description?: React.ReactNode
	children: React.ReactNode
}) {
	return (
		<div className="grid gap-2">
			<div className="mb-2">
				<h3 className="mb-1 text-lg font-medium flex items-center gap-2">
					{Icon && <Icon className="h-4 w-4" />}
					{title}
				</h3>
				{description && <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>}
			</div>
			{children}
		</div>
	)
}

/** Display settings of the current user: theme, language, header, home page, width and meter colors */
export default function AppearanceSettings({ userSettings }: { userSettings: UserSettings }) {
	const [isLoading, setIsLoading] = useState(false)
	const { i18n } = useLingui()
	const { theme, setTheme } = useTheme()
	const currentUserSettings = useStore($userSettings)
	const layoutWidth = currentUserSettings.layoutWidth ?? defaultLayoutWidth
	const [hiddenIcons, setHiddenIcons] = useState<string[]>(userSettings.hiddenHeaderIcons ?? [])

	async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault()
		setIsLoading(true)
		const formData = new FormData(e.target as HTMLFormElement)
		const data = Object.fromEntries(formData) as Partial<UserSettings>
		await saveSettings({ ...data, hiddenHeaderIcons: hiddenIcons })
		setIsLoading(false)
	}

	return (
		<div>
			<div>
				<h3 className="text-xl font-medium mb-2">
					<Trans>Appearance</Trans>
				</h3>
				<p className="text-sm text-muted-foreground leading-relaxed">
					<Trans>Change how the interface looks for your account.</Trans>
				</p>
			</div>
			<Separator className="my-4" />
			<form onSubmit={handleSubmit} className="space-y-5">
				<Section icon={PaletteIcon} title={<Trans>Theme</Trans>}>
					<div className="flex flex-wrap gap-2">
						{themes.map(({ value, icon: Icon, label }) => (
							<Button
								key={value}
								type="button"
								variant="outline"
								className={cn("gap-2", theme === value && "border-primary bg-accent")}
								aria-pressed={theme === value}
								onClick={() => setTheme(value)}
							>
								<Icon className="size-4" />
								{label()}
							</Button>
						))}
					</div>
				</Section>
				<Separator />
				<Section icon={LanguagesIcon} title={<Trans>Language</Trans>}>
					<Label className="block" htmlFor="lang">
						<Trans>Preferred Language</Trans>
					</Label>
					<Select
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
				</Section>
				<Separator />
				<Section
					icon={PanelTopIcon}
					title={<Trans>Header</Trans>}
					description={<Trans>Title of the browser tab, label next to the logo and icons shown in the header.</Trans>}
				>
					<div className="grid sm:grid-cols-3 gap-4">
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
							<Select
								name="headerLabel"
								key={userSettings.headerLabel}
								defaultValue={userSettings.headerLabel ?? "none"}
							>
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
						</div>
					</div>
					<p className="text-xs text-muted-foreground">
						<Trans>Page opened at start and by the logo.</Trans>
					</p>
					<Label className="block mt-3">
						<Trans>Header icons</Trans>
					</Label>
					<div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2.5">
						{(Object.keys(headerIcons) as HeaderIcon[]).map((icon) => (
							<div key={icon} className="flex items-center gap-2 text-sm">
								<Checkbox
									id={`header-icon-${icon}`}
									checked={!hiddenIcons.includes(icon)}
									onCheckedChange={(checked) =>
										setHiddenIcons((hidden) =>
											checked === true ? hidden.filter((i) => i !== icon) : [...hidden.filter((i) => i !== icon), icon]
										)
									}
								/>
								<label htmlFor={`header-icon-${icon}`} className="cursor-pointer">
									{headerIcons[icon]()}
								</label>
							</div>
						))}
					</div>
					<p className="text-xs text-muted-foreground">
						<Trans>The settings and account menus always stay in the header.</Trans>
					</p>
				</Section>
				<Separator />
				<Section icon={MonitorIcon} title={<Trans>Layout width</Trans>}>
					<Label htmlFor="layoutWidth" className="text-sm text-muted-foreground leading-relaxed -mt-2 mb-2">
						<Trans>Adjust the width of the main layout</Trans> ({layoutWidth}px)
					</Label>
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
				</Section>
				<Separator />
				<Section
					title={<Trans>Warning thresholds</Trans>}
					description={<Trans>Set percentage thresholds for meter colors.</Trans>}
				>
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
				</Section>
				<Separator />
				<Button type="submit" className="flex items-center gap-1.5 disabled:opacity-100" disabled={isLoading}>
					{isLoading ? <LoaderCircleIcon className="h-4 w-4 animate-spin" /> : <SaveIcon className="h-4 w-4" />}
					<Trans>Save Settings</Trans>
				</Button>
			</form>
		</div>
	)
}
