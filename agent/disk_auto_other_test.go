//go:build testing && !windows

package agent

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/shirou/gopsutil/v4/disk"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestIsLocalDiskPartition(t *testing.T) {
	tests := []struct {
		p    disk.PartitionStat
		want bool
	}{
		{disk.PartitionStat{Device: "/dev/sdb1", Mountpoint: "/mnt/data", Fstype: "ext4"}, true},
		{disk.PartitionStat{Device: "/dev/nvme0n1p3", Mountpoint: "/home", Fstype: "btrfs"}, true},
		{disk.PartitionStat{Device: "/dev/sdc1", Mountpoint: "/media/usb", Fstype: "fuseblk"}, true},
		{disk.PartitionStat{Device: "/dev/sda1", Mountpoint: "/boot/efi", Fstype: "vfat"}, false},
		{disk.PartitionStat{Device: "/dev/loop3", Mountpoint: "/snap/core/1", Fstype: "squashfs"}, false},
		{disk.PartitionStat{Device: "/dev/loop4", Mountpoint: "/mnt/img", Fstype: "ext4"}, false},
		{disk.PartitionStat{Device: "tmpfs", Mountpoint: "/run", Fstype: "tmpfs"}, false},
		{disk.PartitionStat{Device: "/dev/sda2", Mountpoint: "/var/lib/docker/overlay2", Fstype: "ext4"}, false},
		{disk.PartitionStat{Device: "/dev/sda2", Mountpoint: "/etc/hosts", Fstype: "ext4"}, false},
		{disk.PartitionStat{Device: "tank/data", Mountpoint: "/tank/data", Fstype: "zfs"}, false},
	}
	for _, tt := range tests {
		assert.Equal(t, tt.want, isLocalDiskPartition(tt.p), tt.p.Mountpoint)
	}
}

func TestUnescapeUdev(t *testing.T) {
	assert.Equal(t, "My Data", unescapeUdev(`My\x20Data`))
	assert.Equal(t, "plain", unescapeUdev("plain"))
	assert.Equal(t, `bad\x2`, unescapeUdev(`bad\x2`))
}

func TestDiskLabel(t *testing.T) {
	dir := t.TempDir()
	device := filepath.Join(dir, "sdb1")
	require.NoError(t, os.WriteFile(device, nil, 0o600))
	byLabel := filepath.Join(dir, "by-label")
	require.NoError(t, os.Mkdir(byLabel, 0o755))
	require.NoError(t, os.Symlink(device, filepath.Join(byLabel, `Backup\x20Disk`)))

	assert.Equal(t, "Backup Disk", fsLabel(device, byLabel))
	assert.Equal(t, "", fsLabel(filepath.Join(dir, "other"), byLabel))
	assert.Equal(t, "", diskLabel("/dev/sda1", "/", true))
	assert.Equal(t, "/mnt/nolabel", diskLabel("/dev/nonexistent-device", "/mnt/nolabel", false))
}
