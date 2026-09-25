package agent

import (
	"os"
	"strconv"
	"strings"

	"github.com/henrygd/beszel/agent/utils"
)

// autoFilesystemsEnabled reports whether all local disks are monitored. It is
// the default outside containers (where host disks are mounted in
// /extra-filesystems instead) and can be turned off with AUTO_FILESYSTEMS=false.
func autoFilesystemsEnabled() bool {
	if value, exists := utils.GetEnv("AUTO_FILESYSTEMS"); exists {
		enabled, err := strconv.ParseBool(strings.TrimSpace(value))
		return err != nil || enabled
	}
	return !runningInContainer()
}

// runningInContainer reports whether the agent runs in a Docker or Podman container.
func runningInContainer() bool {
	for _, marker := range []string{"/.dockerenv", "/run/.containerenv"} {
		if _, err := os.Stat(marker); err == nil {
			return true
		}
	}
	return false
}

// addAutoFilesystems registers the local disks that are not tracked yet.
func (d *diskDiscovery) addAutoFilesystems() {
	tracked := make(map[string]bool, len(d.agent.fsStats))
	for _, stats := range d.agent.fsStats {
		tracked[stats.Mountpoint] = true
	}
	for _, p := range d.partitions {
		if tracked[p.Mountpoint] || strings.HasPrefix(p.Mountpoint, d.ctx.efPath) || !isLocalDiskPartition(p) {
			continue
		}
		tracked[p.Mountpoint] = true
		d.addFsStat(p.Device, p.Mountpoint, false, "")
	}
}

// displayDevice returns the device shown next to a disk name: the drive letter
// on Windows, the /dev path elsewhere, or "" when the device is not meaningful.
func displayDevice(device string, isWindows bool) string {
	if isWindows {
		if len(device) == 2 && device[1] == ':' {
			return strings.ToUpper(device)
		}
		return ""
	}
	if strings.HasPrefix(device, "/dev/") {
		return device
	}
	return ""
}

// labelFilesystems names the disks without a custom name after their volume label.
func (a *Agent) labelFilesystems() {
	for _, stats := range a.fsStats {
		if stats.Name == "" && stats.Device != "" {
			stats.Label = diskLabel(stats.Device, stats.Mountpoint, stats.Root)
		}
	}
}
