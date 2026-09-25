package agent

import (
	"bufio"
	"errors"
	"log/slog"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/henrygd/beszel"
	"github.com/henrygd/beszel/agent/utils"
	"github.com/henrygd/beszel/internal/entities/system"
	"github.com/henrygd/beszel/internal/ghupdate"
	"github.com/shirou/gopsutil/v4/process"
)

// startedAt is when the agent process started.
var startedAt = time.Now()

// GetAgentInfoHandler returns how the agent runs on its host.
type GetAgentInfoHandler struct{}

func (h *GetAgentInfoHandler) Handle(hctx *HandlerContext) error {
	return hctx.SendResponse(hctx.Agent.agentInfo(), hctx.RequestID)
}

// GetAgentLogsHandler returns the last lines logged by the agent.
type GetAgentLogsHandler struct{}

func (h *GetAgentLogsHandler) Handle(hctx *HandlerContext) error {
	return hctx.SendResponse(system.AgentLogsResponse{Logs: agentLogs.String()}, hctx.RequestID)
}

// UpdateAgentHandler updates the agent to the latest release, then exits so
// its service manager starts the new executable.
type UpdateAgentHandler struct{}

func (h *UpdateAgentHandler) Handle(hctx *HandlerContext) error {
	info := hctx.Agent.agentInfo()
	if !info.SelfUpdate {
		return hctx.SendResponse(system.AgentUpdateResponse{Error: info.SelfUpdateBlocker}, hctx.RequestID)
	}
	updated, err := selfUpdate(hctx.Agent.dataDir)
	response := system.AgentUpdateResponse{Updated: updated}
	if err != nil {
		response.Error = err.Error()
	}
	sendErr := hctx.SendResponse(response, hctx.RequestID)
	if updated {
		slog.Info("Agent updated, restarting")
		// leave time for the response to reach the hub
		time.AfterFunc(2*time.Second, func() { os.Exit(1) })
	}
	return sendErr
}

var selfUpdateMu sync.Mutex

// selfUpdate replaces the executable with the latest release. It reports
// whether a newer version was installed.
func selfUpdate(dataDir string) (bool, error) {
	if !selfUpdateMu.TryLock() {
		return false, errors.New("an update is already running")
	}
	defer selfUpdateMu.Unlock()
	if dataDir == "" {
		dataDir = os.TempDir()
	}
	updated, err := ghupdate.Update(ghupdate.Config{ArchiveExecutable: "beszel-agent", DataDir: dataDir})
	if err == nil && updated && runtime.GOOS != "windows" {
		if exe, exeErr := os.Executable(); exeErr == nil {
			_ = os.Chmod(exe, 0o755)
		}
	}
	return updated, err
}

func (a *Agent) agentInfo() system.AgentInfo {
	exe, _ := os.Executable()
	manager, service := detectServiceManager()
	info := system.AgentInfo{
		Version:        beszel.ForkVersion,
		Executable:     exe,
		DataDir:        a.dataDir,
		ServiceManager: manager,
		ServiceName:    service,
		StartedAt:      startedAt,
		Dependencies:   a.dependencies(manager),
	}
	if u, err := user.Current(); err == nil {
		info.User = u.Username
	}
	info.SelfUpdate, info.SelfUpdateBlocker = selfUpdateSupport(manager, exe)
	return info
}

// selfUpdateSupport tells whether the agent can update itself: its service
// manager must restart it when it exits, and it must be able to replace its executable.
func selfUpdateSupport(manager, exe string) (bool, string) {
	switch manager {
	case system.ServiceManagerDocker:
		return false, system.SelfUpdateContainer
	case system.ServiceManagerNSSM, system.ServiceManagerSystemd, system.ServiceManagerProcd:
	default:
		return false, system.SelfUpdateRestart
	}
	if exe == "" || !dirWritable(filepath.Dir(exe)) {
		return false, system.SelfUpdateReadOnly
	}
	return true, ""
}

// dirWritable reports whether files can be created in dir.
func dirWritable(dir string) bool {
	f, err := os.CreateTemp(dir, ".beszel-write-test-")
	if err != nil {
		return false
	}
	f.Close()
	os.Remove(f.Name())
	return true
}

// detectServiceManager returns what started the agent and its service name.
func detectServiceManager() (manager, service string) {
	if runningInContainer() {
		return system.ServiceManagerDocker, ""
	}
	serviceName, _ := utils.GetEnv("SERVICE_NAME")
	if serviceName == "" {
		serviceName = "beszel-agent"
	}
	parent, _ := parentProcess()
	switch runtime.GOOS {
	case "windows":
		if strings.EqualFold(parent, "nssm.exe") {
			return system.ServiceManagerNSSM, serviceName
		}
	case "linux":
		if os.Getenv("INVOCATION_ID") != "" {
			return system.ServiceManagerSystemd, systemdUnitName()
		}
		if name := os.Getenv("RC_SVCNAME"); name != "" {
			return system.ServiceManagerOpenRC, name
		}
		if parent == "procd" {
			return system.ServiceManagerProcd, serviceName
		}
	case "freebsd":
		if parent == "daemon" {
			return system.ServiceManagerRC, serviceName
		}
	case "darwin":
		if name := os.Getenv("XPC_SERVICE_NAME"); name != "" && name != "0" {
			return system.ServiceManagerLaunchd, name
		}
	}
	return system.ServiceManagerManual, ""
}

// parentProcess returns the name and executable of the process that started the agent.
func parentProcess() (name, exe string) {
	parent, err := process.NewProcess(int32(os.Getppid()))
	if err != nil {
		return "", ""
	}
	name, _ = parent.Name()
	exe, _ = parent.Exe()
	return name, exe
}

// systemdUnitName reads the unit of the agent from its cgroup, e.g. "beszel-agent".
func systemdUnitName() string {
	f, err := os.Open("/proc/self/cgroup")
	if err != nil {
		return ""
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		for part := range strings.SplitSeq(scanner.Text(), "/") {
			if name, ok := strings.CutSuffix(part, ".service"); ok {
				return name
			}
		}
	}
	return ""
}

// dependencies lists the tools the agent runs with or can use.
func (a *Agent) dependencies(manager string) []system.AgentDependency {
	var deps []system.AgentDependency
	lookPath := func(name string, commands ...string) {
		for _, command := range commands {
			if path, err := exec.LookPath(command); err == nil {
				deps = append(deps, system.AgentDependency{Name: name, Found: true, Detail: path})
				return
			}
		}
		deps = append(deps, system.AgentDependency{Name: name})
	}

	switch runtime.GOOS {
	case "windows":
		if manager == system.ServiceManagerNSSM {
			_, nssm := parentProcess()
			deps = append(deps, system.AgentDependency{Name: "NSSM", Found: true, Detail: nssm})
		} else {
			lookPath("NSSM", "nssm")
		}
		lookPath("WinGet", "winget")
		lookPath("Scoop", "scoop")
		if os.Getenv("LHM") == "true" {
			deps = append(deps, system.AgentDependency{Name: "LibreHardwareMonitor", Found: true})
		}
	case "linux":
		lookPath("journalctl", "journalctl")
	}

	if a.smartManager != nil && a.smartManager.smartctlPath != "" {
		deps = append(deps, system.AgentDependency{Name: "smartctl", Found: true, Detail: a.smartManager.smartctlPath})
	} else {
		lookPath("smartctl", "smartctl")
	}

	container := system.AgentDependency{Name: "Docker / Podman"}
	if a.dockerManager != nil {
		container.Found = true
		if a.dockerManager.usingPodman {
			container.Detail = "Podman"
		} else {
			container.Detail = "Docker"
		}
	}
	deps = append(deps, container)

	// GPU tools are only listed when installed
	for _, gpuTool := range []string{"nvidia-smi", "rocm-smi", "intel_gpu_top"} {
		if path, err := exec.LookPath(gpuTool); err == nil {
			deps = append(deps, system.AgentDependency{Name: gpuTool, Found: true, Detail: path})
		}
	}
	return deps
}
