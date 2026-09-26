/** Parts of the host page a link can open, such as /system/id#processes */
const sections = ["core", "network", "disk", "gpu", "containers", "processes", "services", "reboots"]

/** Event telling the host page already shown to open one of its parts */
export const linkedSectionEvent = "beszel:linked-section"

/** Part of the host page named by the hash of the address */
export function linkedTab() {
	const tab = window.location.hash.slice(1)
	return sections.includes(tab) ? tab : undefined
}

/** Opens a part of the host page when the page is already shown: the link then changes the hash only */
export function announceSection(section: string) {
	if (sections.includes(section)) {
		window.dispatchEvent(new CustomEvent(linkedSectionEvent, { detail: section }))
	}
}
