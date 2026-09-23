//go:build windows

package agent

import (
	"github.com/shirou/gopsutil/v4/disk"
	"golang.org/x/sys/windows"
)

// isLocalDiskPartition reports whether a partition is a fixed drive with a letter
// (removable, network and optical drives are skipped).
func isLocalDiskPartition(p disk.PartitionStat) bool {
	if displayDevice(p.Device, true) == "" {
		return false
	}
	root, err := windows.UTF16PtrFromString(p.Device + `\`)
	if err != nil {
		return false
	}
	return windows.GetDriveType(root) == windows.DRIVE_FIXED
}

// diskLabel returns the volume label of a drive (e.g. "OS" for C:).
func diskLabel(device, _ string, _ bool) string {
	root, err := windows.UTF16PtrFromString(device + `\`)
	if err != nil {
		return ""
	}
	name := make([]uint16, windows.MAX_PATH+1)
	if err := windows.GetVolumeInformation(root, &name[0], uint32(len(name)), nil, nil, nil, nil, 0); err != nil {
		return ""
	}
	return windows.UTF16ToString(name)
}
