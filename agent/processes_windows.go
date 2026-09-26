//go:build windows

package agent

import (
	"context"
	"unsafe"

	"golang.org/x/sys/windows"
)

// threadCounts reads the number of threads of every process in one snapshot:
// asking each process walks all the threads of the host every time.
func threadCounts(context.Context) map[int32]int32 {
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil
	}
	defer windows.CloseHandle(snapshot)
	counts := map[int32]int32{}
	var entry windows.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	for err = windows.Process32First(snapshot, &entry); err == nil; err = windows.Process32Next(snapshot, &entry) {
		counts[int32(entry.ProcessID)] = int32(entry.Threads)
	}
	return counts
}
