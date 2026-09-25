package agent

import (
	"bytes"
	"strings"
	"sync"
)

// agentLogs keeps the last lines logged by the agent, sent to the hub on request.
var agentLogs = newLogBuffer(500)

// logBuffer is an io.Writer keeping the last complete lines written to it.
type logBuffer struct {
	mu      sync.Mutex
	max     int
	lines   []string
	next    int    // index of the oldest line once the buffer is full
	partial []byte // last line, not terminated yet
}

func newLogBuffer(max int) *logBuffer {
	return &logBuffer{max: max}
}

// Write stores the complete lines of p. It never fails, so logging goes on.
func (b *logBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	data := append(b.partial, p...)
	for {
		i := bytes.IndexByte(data, '\n')
		if i < 0 {
			break
		}
		b.add(strings.TrimSuffix(string(data[:i]), "\r"))
		data = data[i+1:]
	}
	b.partial = bytes.Clone(data)
	return len(p), nil
}

func (b *logBuffer) add(line string) {
	if len(b.lines) < b.max {
		b.lines = append(b.lines, line)
		return
	}
	b.lines[b.next] = line
	b.next = (b.next + 1) % b.max
}

// String returns the kept lines, oldest first.
func (b *logBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	ordered := make([]string, 0, len(b.lines))
	ordered = append(ordered, b.lines[b.next:]...)
	ordered = append(ordered, b.lines[:b.next]...)
	return strings.Join(ordered, "\n")
}
