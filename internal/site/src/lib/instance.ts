import { useStore } from "@nanostores/react"
import { computed, map } from "nanostores"
import { useEffect } from "react"
import { pb } from "@/lib/api"
import { $userSettings } from "@/lib/stores"

/** Name shown when the instance has no other name */
const defaultName = "Beszel"

/** Name and URL of this instance (hub settings); urlFromEnv when APP_URL sets the URL */
export const $instance = map({ name: defaultName, url: "", urlFromEnv: false })

/** Save the name and URL of the instance (admins only) */
export async function saveInstance(name: string, url: string) {
	const saved = await pb.send<{ name: string; url: string }>("/api/beszel/instance", {
		method: "POST",
		body: { name, url },
	})
	$instance.set({ ...$instance.get(), ...saved })
}

/** Host of an URL, such as monitoring.example.com, or "" */
export function urlHost(url: string) {
	try {
		return new URL(url).host
	} catch {
		return ""
	}
}

/** Text chosen by the user for an instance label: its name, the host of its URL, or none */
function instanceLabel(choice: string | undefined, instance: { name: string; url: string }) {
	if (choice === "name") {
		return instance.name
	}
	if (choice === "url") {
		return urlHost(instance.url)
	}
	return ""
}

/** End of the browser tab titles: Beszel, or the instance name or host chosen by the user */
export const $titleSuffix = computed(
	[$instance, $userSettings],
	(instance, settings) => instanceLabel(settings.tabTitle, instance) || defaultName
)

/** Label shown next to the logo in the header, "" for none */
export const $headerLabel = computed([$instance, $userSettings], (instance, settings) =>
	instanceLabel(settings.headerLabel, instance)
)

/** Set the browser tab title of a page: "<title> / <instance>" */
export function usePageTitle(title: string) {
	const suffix = useStore($titleSuffix)
	useEffect(() => {
		document.title = title ? `${title} / ${suffix}` : suffix
	}, [title, suffix])
}
