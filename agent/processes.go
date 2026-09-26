package agent

import (
	"context"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/henrygd/beszel/internal/entities/system"
	"github.com/shirou/gopsutil/v4/mem"
	psutilNet "github.com/shirou/gopsutil/v4/net"
	"github.com/shirou/gopsutil/v4/process"
)

const (
	// processesSampleGap is the wait between the two readings of a first request
	processesSampleGap = time.Second
	// processesReuseAfter is the age after which a previous reading no longer
	// serves for the rates, and two new readings are taken
	processesReuseAfter = time.Minute
	// maxCommandLength caps the command lines sent to the hub
	maxCommandLength = 500
)

// GetProcessesHandler returns the processes of the host with their use of the resources.
type GetProcessesHandler struct{}

func (h *GetProcessesHandler) Handle(hctx *HandlerContext) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	return hctx.SendResponse(processes.read(ctx), hctx.RequestID)
}

// processSample is the counters of a process at a reading.
type processSample struct {
	created   int64
	cpu       float64 // seconds of CPU
	readBytes uint64
	writeByte uint64
}

// processReader keeps the previous reading, to give the use of the resources
// since then, and the names of the users (slow to read on Windows).
type processReader struct {
	sync.Mutex
	at    time.Time
	prev  map[int32]processSample
	users map[int32]userEntry
}

type userEntry struct {
	created int64
	name    string
}

var processes = &processReader{users: map[int32]userEntry{}}

// read returns the processes, with the rates since the previous reading, or
// over a short gap when there is none recent.
func (r *processReader) read(ctx context.Context) system.ProcessesResponse {
	r.Lock()
	defer r.Unlock()
	if r.prev == nil || time.Since(r.at) > processesReuseAfter {
		r.prev, _ = sampleProcesses(ctx)
		r.at = time.Now()
		select {
		case <-time.After(processesSampleGap):
		case <-ctx.Done():
		}
	}
	current, procs := sampleProcesses(ctx)
	now := time.Now()
	elapsed := now.Sub(r.at).Seconds()
	cores := runtime.NumCPU()
	var total uint64
	if vm, err := mem.VirtualMemoryWithContext(ctx); err == nil {
		total = vm.Total
	}
	conns := connectionsByPID(ctx)
	threads := threadCounts(ctx)

	list := make([]system.Process, 0, len(procs))
	for _, p := range procs {
		info := system.Process{PID: p.Pid}
		sample := current[p.Pid]
		info.Started = sample.created / 1000
		if name, err := p.NameWithContext(ctx); err == nil {
			info.Name = name
		}
		if info.Name == "" {
			continue
		}
		info.PPID, _ = p.PpidWithContext(ctx)
		info.User = r.user(ctx, p, sample.created)
		if statuses, err := p.StatusWithContext(ctx); err == nil && len(statuses) > 0 {
			info.Status = statuses[0]
		}
		if cmd, err := p.CmdlineWithContext(ctx); err == nil {
			info.Command = truncateCommand(cmd)
		}
		if memInfo, err := p.MemoryInfoWithContext(ctx); err == nil && memInfo != nil {
			info.RSS = memInfo.RSS
			if total > 0 {
				info.Memory = float64(memInfo.RSS) / float64(total) * 100
			}
		}
		if count, ok := threads[p.Pid]; ok {
			info.Threads = count
		} else if threads == nil {
			info.Threads, _ = p.NumThreadsWithContext(ctx)
		}
		info.Connections = conns[p.Pid]
		if before, ok := r.prev[p.Pid]; ok && before.created == sample.created && elapsed > 0 {
			info.CPU = max(sample.cpu-before.cpu, 0) / elapsed / float64(cores) * 100
			if sample.readBytes >= before.readBytes {
				info.DiskRead = float64(sample.readBytes-before.readBytes) / elapsed
			}
			if sample.writeByte >= before.writeByte {
				info.DiskWrite = float64(sample.writeByte-before.writeByte) / elapsed
			}
		}
		list = append(list, info)
	}
	r.prev, r.at = current, now
	// forget the users of the processes gone
	for pid := range r.users {
		if _, ok := current[pid]; !ok {
			delete(r.users, pid)
		}
	}
	return system.ProcessesResponse{Processes: list, Cores: cores}
}

// user returns the user of a process, read once per process.
func (r *processReader) user(ctx context.Context, p *process.Process, created int64) string {
	if entry, ok := r.users[p.Pid]; ok && entry.created == created {
		return entry.name
	}
	name, _ := p.UsernameWithContext(ctx)
	r.users[p.Pid] = userEntry{created: created, name: name}
	return name
}

// sampleProcesses reads the CPU time and disk counters of all the processes.
func sampleProcesses(ctx context.Context) (map[int32]processSample, []*process.Process) {
	procs, err := process.ProcessesWithContext(ctx)
	if err != nil {
		return map[int32]processSample{}, nil
	}
	samples := make(map[int32]processSample, len(procs))
	for _, p := range procs {
		var sample processSample
		sample.created, _ = p.CreateTimeWithContext(ctx)
		if times, err := p.TimesWithContext(ctx); err == nil && times != nil {
			sample.cpu = times.User + times.System
		}
		if io, err := p.IOCountersWithContext(ctx); err == nil && io != nil {
			sample.readBytes, sample.writeByte = io.ReadBytes, io.WriteBytes
		}
		samples[p.Pid] = sample
	}
	return samples, procs
}

// connectionsByPID counts the open sockets of each process, in one reading.
func connectionsByPID(ctx context.Context) map[int32]int {
	counts := map[int32]int{}
	conns, err := psutilNet.ConnectionsWithContext(ctx, "inet")
	if err != nil {
		return counts
	}
	for _, conn := range conns {
		if conn.Pid > 0 {
			counts[conn.Pid]++
		}
	}
	return counts
}

func truncateCommand(cmd string) string {
	cmd = strings.TrimSpace(cmd)
	if r := []rune(cmd); len(r) > maxCommandLength {
		return string(r[:maxCommandLength]) + "…"
	}
	return cmd
}
