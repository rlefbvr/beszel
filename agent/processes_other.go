//go:build !windows

package agent

import "context"

// threadCounts is nil: reading the threads of each process is cheap here.
func threadCounts(context.Context) map[int32]int32 {
	return nil
}
