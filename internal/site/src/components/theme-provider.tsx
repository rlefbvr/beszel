import { useStore } from "@nanostores/react"
import { createContext, useContext, useEffect, useState } from "react"
import { pb, queueUserSettings } from "@/lib/api"
import { $userSettings } from "@/lib/stores"

type Theme = "dark" | "light" | "system"
type ResolvedTheme = "dark" | "light"

type ThemeProviderProps = {
	children: React.ReactNode
	defaultTheme?: Theme
	storageKey?: string
}

type ThemeProviderState = {
	theme: Theme
	resolvedTheme: ResolvedTheme
	setTheme: (theme: Theme) => void
}

const initialState: ThemeProviderState = {
	theme: "system",
	resolvedTheme: "light",
	setTheme: () => null,
}

const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

export function ThemeProvider({
	children,
	defaultTheme = "system",
	storageKey = "ui-theme",
	...props
}: ThemeProviderProps) {
	const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(storageKey) as Theme) || defaultTheme)
	const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches)

	useEffect(() => {
		const media = window.matchMedia("(prefers-color-scheme: dark)")
		const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)

		media.addEventListener("change", onChange)
		return () => media.removeEventListener("change", onChange)
	}, [])

	// the theme saved with the user follows them from one browser to another
	const userTheme = useStore($userSettings).theme
	useEffect(() => {
		if (userTheme) {
			localStorage.setItem(storageKey, userTheme)
			setTheme(userTheme)
		}
	}, [userTheme, storageKey])

	const resolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme

	useEffect(() => {
		const root = window.document.documentElement

		root.classList.remove("light", "dark")
		root.classList.add(resolvedTheme)
	}, [resolvedTheme])

	const value = {
		theme,
		resolvedTheme,
		setTheme: (theme: Theme) => {
			localStorage.setItem(storageKey, theme)
			setTheme(theme)
			if (pb.authStore.isValid) {
				$userSettings.setKey("theme", theme)
				queueUserSettings({ theme })
			}
		},
	}

	return (
		<ThemeProviderContext.Provider {...props} value={value}>
			{children}
		</ThemeProviderContext.Provider>
	)
}

export const useTheme = () => useContext(ThemeProviderContext)
