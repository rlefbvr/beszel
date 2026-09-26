package sensors

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"net"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/icmp"
	"golang.org/x/net/ipv4"
	"golang.org/x/net/ipv6"
)

const (
	// tracerouteMaxHops bounds the routes followed.
	tracerouteMaxHops = 30
	// tracerouteHopTimeout is the wait for the answer of a hop.
	tracerouteHopTimeout = 1500 * time.Millisecond
	// tracerouteSilentHops stops a route whose last hops stay silent, such as
	// a destination dropping ICMP.
	tracerouteSilentHops = 6
)

// Hop is a router of the route to a host, or the host itself.
type Hop struct {
	TTL int `json:"ttl"`
	// IP is empty for a hop that did not answer.
	IP   string `json:"ip,omitempty"`
	Name string `json:"name,omitempty"`
	// RTT is the round trip in milliseconds, 0 without an answer.
	RTT float64 `json:"rtt"`
}

// Traceroute is the route from the hub to a host.
type Traceroute struct {
	Target  string `json:"target"`
	IP      string `json:"ip"`
	Hops    []Hop  `json:"hops"`
	Reached bool   `json:"reached"`
	// Method is "icmp" (sent by the hub) or "command" (system traceroute).
	Method string `json:"method"`
}

// RunTraceroute follows the route from the hub to a host: ICMP echo requests
// with an increasing TTL, or the traceroute command of the system when the hub
// may not open a raw socket.
func RunTraceroute(ctx context.Context, target string) (*Traceroute, error) {
	family, ip, err := resolveICMPTarget(ctx, target)
	if err != nil {
		return nil, err
	}
	if ip == nil {
		return nil, errors.New("no address for " + target)
	}
	result := &Traceroute{Target: target, IP: ip.String()}
	conn, err := icmp.ListenPacket(family.rawNetwork, family.listenAddr)
	if err == nil {
		result.Method = "icmp"
		result.Hops, result.Reached = tracerouteICMP(ctx, conn, family, ip)
		conn.Close()
		// no answer at all: the system may filter the ICMP errors of the routers
		// (Windows), the traceroute command gets them
		if !result.Reached && !anyAnswer(result.Hops) {
			if hops, reached, cmdErr := tracerouteCommand(ctx, ip, family.isIPv6); cmdErr == nil && anyAnswer(hops) {
				result.Method, result.Hops, result.Reached = "command", hops, reached
			}
		}
	} else {
		result.Method = "command"
		result.Hops, result.Reached, err = tracerouteCommand(ctx, ip, family.isIPv6)
		if err != nil {
			return nil, err
		}
	}
	resolveHopNames(ctx, result.Hops)
	return result, nil
}

// tracerouteICMP sends one echo request per TTL and reads the time exceeded
// answers of the routers, until the host answers.
func tracerouteICMP(ctx context.Context, conn *icmp.PacketConn, family *icmpFamily, ip net.IP) ([]Hop, bool) {
	id := int(icmpSequence.Add(1) & 0xffff)
	var hops []Hop
	silent := 0
	for ttl := 1; ttl <= tracerouteMaxHops && ctx.Err() == nil; ttl++ {
		if family.isIPv6 {
			_ = conn.IPv6PacketConn().SetHopLimit(ttl)
		} else {
			_ = conn.IPv4PacketConn().SetTTL(ttl)
		}
		msg := icmp.Message{Type: family.echoType, Body: &icmp.Echo{ID: id, Seq: ttl, Data: []byte("beszel-traceroute")}}
		packet, err := msg.Marshal(nil)
		if err != nil {
			break
		}
		start := time.Now()
		if _, err := conn.WriteTo(packet, &net.IPAddr{IP: ip}); err != nil {
			break
		}
		hop := Hop{TTL: ttl}
		reached := false
		deadline := start.Add(tracerouteHopTimeout)
		_ = conn.SetReadDeadline(deadline)
		buf := make([]byte, 1500)
		for {
			n, from, err := conn.ReadFrom(buf)
			if err != nil {
				break
			}
			reply, err := icmp.ParseMessage(family.proto, buf[:n])
			if err != nil {
				continue
			}
			switch body := reply.Body.(type) {
			case *icmp.Echo:
				if (reply.Type == ipv4.ICMPTypeEchoReply || reply.Type == ipv6.ICMPTypeEchoReply) && body.ID == id && body.Seq == ttl {
					reached = true
				} else {
					continue
				}
			case *icmp.TimeExceeded:
				if !matchesEcho(body.Data, family.isIPv6, id, ttl) {
					continue
				}
			case *icmp.DstUnreach:
				if !matchesEcho(body.Data, family.isIPv6, id, ttl) {
					continue
				}
			default:
				continue
			}
			hop.IP = icmpAddrIP(from).String()
			hop.RTT = float64(time.Since(start).Microseconds()) / 1000
			break
		}
		hops = append(hops, hop)
		if reached {
			return hops, true
		}
		if hop.IP == "" {
			silent++
			if silent >= tracerouteSilentHops {
				break
			}
		} else {
			silent = 0
		}
	}
	return trimSilentHops(hops), false
}

// anyAnswer tells whether a hop of the route answered.
func anyAnswer(hops []Hop) bool {
	for _, hop := range hops {
		if hop.IP != "" {
			return true
		}
	}
	return false
}

// matchesEcho tells whether the packet quoted by an ICMP error is our echo request of this TTL.
func matchesEcho(quoted []byte, isIPv6 bool, id, seq int) bool {
	offset := 40 // IPv6 header
	if !isIPv6 {
		if len(quoted) < 1 {
			return false
		}
		offset = int(quoted[0]&0x0f) * 4
	}
	if len(quoted) < offset+8 {
		return false
	}
	echo := quoted[offset:]
	return int(binary.BigEndian.Uint16(echo[4:6])) == id && int(binary.BigEndian.Uint16(echo[6:8])) == seq
}

// trimSilentHops drops the silent hops at the end of a route that did not reach its host.
func trimSilentHops(hops []Hop) []Hop {
	last := len(hops)
	for last > 0 && hops[last-1].IP == "" {
		last--
	}
	// keep one silent hop to show where the route stops answering
	return hops[:min(len(hops), last+1)]
}

var (
	hopLineRegex = regexp.MustCompile(`^\s*(\d+)\s+(.*)$`)
	hopIPRegex   = regexp.MustCompile(`(\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F]*:[0-9a-fA-F:]+)`)
	hopRTTRegex  = regexp.MustCompile(`[<]?\s*([0-9]+(?:[.,][0-9]+)?)\s*ms`)
)

// tracerouteCommand runs the traceroute command of the system, without name resolution.
func tracerouteCommand(ctx context.Context, ip net.IP, isIPv6 bool) ([]Hop, bool, error) {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		args := []string{"-d", "-h", strconv.Itoa(tracerouteMaxHops), "-w", "1000"}
		if isIPv6 {
			args = append(args, "-6")
		}
		cmd = exec.CommandContext(ctx, "tracert", append(args, ip.String())...)
	} else {
		args := []string{"-n", "-q", "1", "-w", "2", "-m", strconv.Itoa(tracerouteMaxHops)}
		if isIPv6 {
			args = append(args, "-6")
		}
		cmd = exec.CommandContext(ctx, "traceroute", append(args, ip.String())...)
	}
	output, err := cmd.Output()
	if err != nil && len(output) == 0 {
		return nil, false, errors.New("traceroute unavailable: " + err.Error())
	}
	hops := parseTracerouteOutput(output)
	reached := len(hops) > 0 && hops[len(hops)-1].IP == ip.String()
	return hops, reached, nil
}

// parseTracerouteOutput reads the hops of the output of traceroute or tracert:
// one line per TTL, with the address of the hop and its round trips.
func parseTracerouteOutput(output []byte) []Hop {
	var hops []Hop
	scanner := bufio.NewScanner(bytes.NewReader(output))
	for scanner.Scan() {
		match := hopLineRegex.FindStringSubmatch(scanner.Text())
		if match == nil {
			continue
		}
		ttl, err := strconv.Atoi(match[1])
		if err != nil || ttl < 1 || ttl > 255 {
			continue
		}
		rest := match[2]
		hop := Hop{TTL: ttl}
		// the address is the last one of the line, after the round trips on Windows
		if ips := hopIPRegex.FindAllString(rest, -1); len(ips) > 0 {
			if parsed := net.ParseIP(ips[len(ips)-1]); parsed != nil {
				hop.IP = parsed.String()
			}
		}
		if rtt := hopRTTRegex.FindStringSubmatch(rest); rtt != nil {
			hop.RTT, _ = strconv.ParseFloat(strings.ReplaceAll(rtt[1], ",", "."), 64)
		}
		hops = append(hops, hop)
	}
	return hops
}

// resolveHopNames finds the names of the hops, briefly and in parallel.
func resolveHopNames(ctx context.Context, hops []Hop) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	var wg sync.WaitGroup
	for i := range hops {
		if hops[i].IP == "" {
			continue
		}
		wg.Go(func() {
			if names, err := net.DefaultResolver.LookupAddr(ctx, hops[i].IP); err == nil && len(names) > 0 {
				hops[i].Name = strings.TrimSuffix(names[0], ".")
			}
		})
	}
	wg.Wait()
}
