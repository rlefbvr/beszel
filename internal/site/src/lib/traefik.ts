import { map } from "nanostores"
import { pb } from "@/lib/api"

/** An HTTP router of a Traefik instance */
export interface TraefikRoute {
	router: string
	rule?: string
	/** names of the Host() matchers of the rule */
	hosts?: string[]
	tls?: boolean
	/** ACME resolver giving the certificate of the router */
	resolver?: string
	entryPoints?: string[]
	/** container the router sends to (docker provider) */
	container?: string
	service?: string
	/** where the router is defined: docker or file */
	provider?: string
}

/** An ACME resolver of a Traefik instance */
export interface TraefikResolver {
	name: string
	/** acme.json on the host */
	storage?: string
	certificates?: number
	error?: string
}

/** A Traefik running on a host, in a container or as a service */
export interface TraefikInstance {
	/** id of the container, empty for a service */
	id?: string
	name: string
	image?: string
	version?: string
	state?: string
	status?: string
	configFile?: string
	/** address of the dashboard through a router of the instance */
	dashboard?: string
	/** port of the host publishing the insecure API and dashboard */
	dashboardPort?: number
	/** "file:<path>", "stdout", or empty when not enabled */
	log?: string
	accessLog?: string
	resolvers?: TraefikResolver[]
	routes?: TraefikRoute[]
	error?: string
}

/** The answer of a host about its Traefik instances */
export interface TraefikOverview {
	system: string
	/** "outdated" for an agent older than 0.20.0-fork.6 */
	error?: string
	instances: TraefikInstance[]
}

/** The Traefik instances last read, by system: their routes give the web certificates of their host */
export const $traefik = map<Record<string, TraefikInstance[]>>({})

/** Asks the hub for the Traefik instances of the hosts, read from their agents */
export async function fetchTraefik(systems: string[]): Promise<TraefikOverview[]> {
	if (!systems.length) {
		return []
	}
	const res = await pb.send<{ systems: TraefikOverview[] }>("/api/beszel/traefik", {
		query: { systems: systems.join(",") },
		requestKey: null,
	})
	for (const overview of res.systems) {
		if (!overview.error) {
			$traefik.setKey(overview.system, overview.instances)
		}
	}
	return res.systems
}

/** Whether a certificate name covers a host: the same name, or a wildcard of its domain */
export function nameCovers(name: string, host: string) {
	const certName = name.toLowerCase()
	const hostName = host.toLowerCase()
	if (certName === hostName) {
		return true
	}
	return (
		certName.startsWith("*.") &&
		hostName.endsWith(certName.slice(1)) &&
		!hostName.slice(0, -certName.length + 1).includes(".")
	)
}

/** Asks the hub for the last lines of the log, or access log, of an instance */
export function fetchTraefikLog(system: string, instance: string, access: boolean) {
	return pb.send<{ lines: string; source: string }>("/api/beszel/traefik/log", {
		query: { system, instance, access: access ? 1 : 0 },
		requestKey: null,
	})
}

/** Address of the dashboard of an instance: its router, or the published port of the insecure API on the host */
export function traefikDashboard(instance: TraefikInstance, host: string) {
	if (instance.dashboard) {
		return instance.dashboard
	}
	return instance.dashboardPort && host ? `http://${host}:${instance.dashboardPort}/dashboard/` : ""
}

/** Address of a route: its first host, in https when the router uses TLS */
export function traefikRouteUrl(route: TraefikRoute) {
	const host = route.hosts?.[0]
	if (!host) {
		return ""
	}
	const secure = route.tls || route.entryPoints?.some((entry) => /secure|https|443/i.test(entry))
	return `${secure ? "https" : "http"}://${host}`
}
