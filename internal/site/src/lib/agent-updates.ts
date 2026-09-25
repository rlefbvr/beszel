import { t } from "@lingui/core/macro"
import { atom } from "nanostores"
import { pb } from "@/lib/api"
import type { SystemRecord } from "@/types"

/** Version of the latest agent release, "" until known */
export const $latestAgentVersion = atom("")

/** Fetch the version of the latest agent release (cached by the hub) */
export async function refreshLatestAgentVersion() {
	try {
		const { version } = await pb.send<{ version: string }>("/api/beszel/agent/latest", {})
		$latestAgentVersion.set(version ?? "")
	} catch (e) {
		console.error("get latest agent version", e)
	}
}

/**
 * Parts of a version such as "0.20.0-fork.2": major, minor, patch and fork
 * revision. Upstream versions have no fork revision and come before the fork
 * releases of the same version.
 */
function versionParts(version: string): number[] {
	const [base, suffix = ""] = version.trim().replace(/^v/, "").split("-", 2)
	const [major = 0, minor = 0, patch = 0] = base.split(".").map((n) => Number.parseInt(n, 10) || 0)
	const fork = /^fork\.(\d+)/.exec(suffix)
	return [major, minor, patch, fork ? Number(fork[1]) : -1]
}

/** Negative when a is older than b, positive when newer, 0 when equal */
export function compareAgentVersions(a: string, b: string) {
	const pa = versionParts(a)
	const pb = versionParts(b)
	for (let i = 0; i < pa.length; i++) {
		if (pa[i] !== pb[i]) {
			return pa[i] - pb[i]
		}
	}
	return 0
}

/** Whether the agent of a system is older than the latest release */
export function agentNeedsUpdate(system: SystemRecord, latest: string) {
	const version = system.info?.v
	return !!version && !!latest && compareAgentVersions(version, latest) < 0
}

export interface AgentUpdateResult {
	updated: boolean
	error?: string
}

/** Ask the agents of systems to update themselves to the latest release */
export function updateAgents(systems: string[]) {
	return pb.send<Record<string, AgentUpdateResult>>("/api/beszel/agent/update", {
		method: "POST",
		body: { systems },
	})
}

/** Explanation of an update error returned by the agent or the hub */
export function agentUpdateErrorLabel(error: string) {
	switch (error) {
		case "container":
			return t`Runs in a container: update its image instead.`
		case "restart":
			return t`No service restarts the agent after an update.`
		case "readonly":
			return t`The agent can't replace its executable. Reinstall it with the current install command.`
		case "outdated":
			return t`This agent is too old to be managed from the hub: update it once on the system.`
		case "not found":
			return t`System not found.`
		default:
			return error
	}
}
