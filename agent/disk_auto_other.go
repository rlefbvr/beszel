//go:build !windows

package agent

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/shirou/gopsutil/v4/disk"
)

// localDiskFsTypes are the filesystems of local disks worth monitoring.
var localDiskFsTypes = map[string]bool{
	"ext2": true, "ext3": true, "ext4": true, "xfs": true, "btrfs": true, "bcachefs": true,
	"f2fs": true, "jfs": true, "reiserfs": true, "vfat": true, "exfat": true,
	"ntfs": true, "ntfs3": true, "fuseblk": true,
}

// isLocalDiskPartition reports whether a partition is a local disk, skipping
// virtual devices, boot partitions and mounts managed by snap or containers.
func isLocalDiskPartition(p disk.PartitionStat) bool {
	if !strings.HasPrefix(p.Device, "/dev/") || !localDiskFsTypes[p.Fstype] || isDockerSpecialMountpoint(p.Mountpoint) {
		return false
	}
	name := filepath.Base(p.Device)
	for _, prefix := range []string{"loop", "sr", "zram", "ram", "fd"} {
		if strings.HasPrefix(name, prefix) {
			return false
		}
	}
	switch p.Mountpoint {
	case "/boot", "/boot/efi", "/efi":
		return false
	}
	for _, prefix := range []string{"/snap/", "/run/", "/proc/", "/sys/", "/var/lib/docker/", "/var/lib/containers/", "/var/lib/kubelet/"} {
		if strings.HasPrefix(p.Mountpoint, prefix) {
			return false
		}
	}
	return true
}

// diskLabel returns the filesystem label of a disk, or its mountpoint. The root
// disk gets no label so it is shown as "Root".
func diskLabel(device, mountpoint string, root bool) string {
	if root {
		return ""
	}
	if label := fsLabel(device, "/dev/disk/by-label"); label != "" {
		return label
	}
	return mountpoint
}

// fsLabel looks up the label of a device in udev's by-label symlinks.
func fsLabel(device, byLabelDir string) string {
	entries, err := os.ReadDir(byLabelDir)
	if err != nil {
		return ""
	}
	target, err := filepath.EvalSymlinks(device)
	if err != nil {
		target = device
	}
	for _, entry := range entries {
		resolved, err := filepath.EvalSymlinks(filepath.Join(byLabelDir, entry.Name()))
		if err == nil && resolved == target {
			return unescapeUdev(entry.Name())
		}
	}
	return ""
}

// unescapeUdev decodes the \xNN sequences udev uses in symlink names (e.g. spaces).
func unescapeUdev(s string) string {
	if !strings.Contains(s, `\x`) {
		return s
	}
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] == '\\' && i+4 <= len(s) && s[i+1] == 'x' {
			if c, err := strconv.ParseUint(s[i+2:i+4], 16, 8); err == nil {
				b.WriteByte(byte(c))
				i += 3
				continue
			}
		}
		b.WriteByte(s[i])
	}
	return b.String()
}
