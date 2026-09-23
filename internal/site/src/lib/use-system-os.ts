import { useEffect, useState } from "react"
import { pb } from "@/lib/api"
import type { Os } from "@/lib/enums"
import type { SystemDetailsRecord, SystemRecord } from "@/types"

/** In-flight or resolved OS lookups, keyed by system id */
const osRequests = new Map<string, Promise<Os | undefined>>()

function fetchSystemOs(systemId: string): Promise<Os | undefined> {
	let request = osRequests.get(systemId)
	if (!request) {
		request = pb
			.collection<SystemDetailsRecord>("system_details")
			.getOne(systemId, { fields: "os" })
			.then((details) => details.os)
			.catch(() => {
				// allow a retry on the next lookup
				osRequests.delete(systemId)
				return undefined
			})
		osRequests.set(systemId, request)
	}
	return request
}

/** OS of a system. Agents report it in system_details; info.os is only set by older agents. */
export function useSystemOs(system?: SystemRecord): Os | undefined {
	const [os, setOs] = useState<Os | undefined>(system?.info?.os)
	useEffect(() => {
		if (!system?.id) {
			return
		}
		let active = true
		fetchSystemOs(system.id).then((detailsOs) => {
			if (active) {
				setOs(detailsOs ?? system.info?.os)
			}
		})
		return () => {
			active = false
		}
	}, [system?.id])
	return os
}
