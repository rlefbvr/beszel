//go:build windows

package agent

import (
	"fmt"
	"log/slog"
	"os"
	"path"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/henrygd/beszel/internal/entities/systemd"
	"github.com/shirou/gopsutil/v4/process"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

const (
	winErrServiceSpecific    = 1066 // ERROR_SERVICE_SPECIFIC_ERROR
	winErrNeverStarted       = 1077 // ERROR_SERVICE_NEVER_STARTED (pas une panne)
	winConfigRefreshInterval = 10 * time.Minute
)

// Configuration d'un service (change rarement : mise en cache 10 minutes).
type winSvcConfig struct {
	displayName string // nom complet, ex. « Print Spooler »
	description string // description longue (QueryServiceConfig2)
	startLabel  string // libellé Windows : Automatic, Automatic (Delayed Start), Manual, Disabled
	unitState   string // équivalent systemd : enabled / disabled
	binaryPath  string
	account     string
}

type winEntry struct {
	name string
	cfg  winSvcConfig
	st   svc.Status
	exit uint32 // code de sortie effectif (spécifique au service si 1066)
}

// Une ligne affichée dans Beszel : un service seul, ou UN processus partagé
// (svchost & co) regroupant tous les services qu'il héberge.
type winGroup struct {
	key     string
	pid     uint32
	image   string
	members []winEntry
}

type systemdManager struct {
	sync.Mutex
	*serviceRefresher
	hasFreshStats bool // lu par agent.go : true après un rafraîchissement
	patterns      []string
	stats         map[string]*systemd.Service
	groups        map[string]*winGroup
	pids          map[string]uint32
	cfgCache      map[string]winSvcConfig
	cfgAt         time.Time
}

func winEnv(key string) string {
	if v, ok := os.LookupEnv("BESZEL_AGENT_" + key); ok {
		return v
	}
	return os.Getenv(key)
}

func newSystemdManager() (*systemdManager, error) {
	if winEnv("SKIP_SYSTEMD") == "true" {
		return nil, fmt.Errorf("services monitoring disabled")
	}
	m, err := winOpenSCM()
	if err != nil {
		return nil, err
	}
	m.Disconnect()

	sm := &systemdManager{
		serviceRefresher: newServiceRefresher(),
		stats:            map[string]*systemd.Service{},
		groups:           map[string]*winGroup{},
		pids:             map[string]uint32{},
	}
	for _, p := range strings.Split(winEnv("SERVICE_PATTERNS"), ",") {
		if p = strings.ToLower(strings.TrimSpace(p)); p != "" {
			sm.patterns = append(sm.patterns, p)
		}
	}
	sm.startWorker()
	return sm, nil
}

// startWorker reprend le cycle de la version Linux : relevé initial, puis
// à l'intervalle fixé par le hub (10 minutes par défaut). agent.go n'envoie
// les services au hub que lorsque hasFreshStats est vrai.
func (sm *systemdManager) startWorker() {
	_ = sm.getServiceStats(nil, true)
	go sm.runRefreshLoop(nil, func() {
		_ = sm.getServiceStats(nil, true)
	})
}

// getServiceStats : refresh=true relit le SCM et marque les données comme
// fraîches ; refresh=false renvoie le cache et consomme ce marqueur (comme Linux).
func (sm *systemdManager) getServiceStats(_ any, refresh bool) []*systemd.Service {
	sm.Lock()
	defer sm.Unlock()
	if refresh {
		if err := sm.refreshLocked(); err != nil {
			slog.Debug("windows services", "err", err)
			return nil
		}
		sm.hasFreshStats = true
	} else {
		sm.hasFreshStats = false
	}
	out := make([]*systemd.Service, 0, len(sm.stats))
	for _, s := range sm.stats {
		out = append(out, s)
	}
	return out
}

func (sm *systemdManager) getServiceStatsCount() int {
	sm.Lock()
	defer sm.Unlock()
	return len(sm.stats)
}

func (sm *systemdManager) getFailedServiceCount() uint16 {
	sm.Lock()
	defer sm.Unlock()
	var n uint16
	for _, s := range sm.stats {
		if s.State == systemd.StatusFailed {
			n++
		}
	}
	return n
}

// Droits minimaux : pas besoin d'être administrateur, contrairement à
// mgr.Connect() / m.OpenService() qui demandent *_ALL_ACCESS.
func winOpenSCM() (*mgr.Mgr, error) {
	h, err := windows.OpenSCManager(nil, nil,
		windows.SC_MANAGER_CONNECT|windows.SC_MANAGER_ENUMERATE_SERVICE)
	if err != nil {
		return nil, err
	}
	return &mgr.Mgr{Handle: h}, nil
}

func winOpenService(m *mgr.Mgr, name string) (*mgr.Service, error) {
	n, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return nil, err
	}
	h, err := windows.OpenService(m.Handle, n,
		windows.SERVICE_QUERY_STATUS|windows.SERVICE_QUERY_CONFIG)
	if err != nil {
		return nil, err
	}
	return &mgr.Service{Name: name, Handle: h}, nil
}

func (sm *systemdManager) refreshLocked() error {
	m, err := winOpenSCM()
	if err != nil {
		return err
	}
	defer m.Disconnect()

	names, err := m.ListServices()
	if err != nil {
		return err
	}

	reloadCfg := sm.cfgCache == nil || time.Since(sm.cfgAt) > winConfigRefreshInterval
	if reloadCfg {
		sm.cfgCache = map[string]winSvcConfig{}
		sm.cfgAt = time.Now()
	}

	entries := make([]winEntry, 0, len(names))
	for _, name := range names {
		s, err := winOpenService(m, name)
		if err != nil {
			continue
		}
		st, err := s.Query()
		if err != nil {
			s.Close()
			continue
		}
		cfg, ok := sm.cfgCache[name]
		if !ok {
			if c, err := s.Config(); err == nil {
				cfg = toWinSvcConfig(c)
				sm.cfgCache[name] = cfg
			}
		}
		s.Close()
		entries = append(entries, winEntry{name: name, cfg: cfg, st: st, exit: winExitCode(st)})
	}

	seen := map[string]bool{}
	for _, g := range winBuildGroups(entries) {
		if !sm.includeGroup(g) {
			continue
		}
		seen[g.key] = true
		sm.groups[g.key] = g
		sm.updateStats(g)
	}
	for k := range sm.stats {
		if !seen[k] {
			delete(sm.stats, k)
			delete(sm.groups, k)
			delete(sm.pids, k)
		}
	}
	return nil
}

// winBuildGroups ne garde qu'une entrée par PID partagé.
func winBuildGroups(entries []winEntry) []*winGroup {
	var groups []*winGroup
	byPID := map[uint32][]winEntry{}
	for _, e := range entries {
		if e.st.ProcessId == 0 {
			groups = append(groups, &winGroup{key: winLabel(e), members: []winEntry{e}})
			continue
		}
		byPID[e.st.ProcessId] = append(byPID[e.st.ProcessId], e)
	}
	for pid, members := range byPID {
		if len(members) == 1 {
			groups = append(groups, &winGroup{key: winLabel(members[0]), pid: pid, members: members})
			continue
		}
		sort.Slice(members, func(i, j int) bool { return members[i].name < members[j].name })
		names := make([]string, len(members))
		for i, e := range members {
			names[i] = e.name
		}
		image := winImageName(pid)
		groups = append(groups, &winGroup{
			// Nom stable d'un redémarrage à l'autre tant que le regroupement ne change pas
			key:     fmt.Sprintf("%s [%s]", image, strings.Join(names, ", ")),
			pid:     pid,
			image:   image,
			members: members,
		})
	}
	return groups
}

// winLabel produit le nom affiché dans la liste : « Print Spooler (Spooler) ».
// Nom court seul si le nom complet est absent, identique, ou non résolu
// (chaîne indirecte du type « @%SystemRoot%\...dll,-123 »).
func winLabel(e winEntry) string {
	dn := strings.TrimSpace(e.cfg.displayName)
	if dn == "" || strings.EqualFold(dn, e.name) || strings.HasPrefix(dn, "@") {
		return e.name
	}
	return fmt.Sprintf("%s (%s)", dn, e.name)
}

func winImageName(pid uint32) string {
	if p, err := process.NewProcess(int32(pid)); err == nil {
		if n, err := p.Name(); err == nil && n != "" {
			return n
		}
	}
	return fmt.Sprintf("pid-%d", pid)
}

// Filtre : un groupe est gardé si au moins un de ses services correspond.
// Sans SERVICE_PATTERNS : démarrage automatique, ou en cours d'exécution,
// ou en échec (équivalent du « actif au moins une fois » de Linux).
func (sm *systemdManager) includeGroup(g *winGroup) bool {
	for _, e := range g.members {
		if sm.include(e) {
			return true
		}
	}
	return false
}

func (sm *systemdManager) include(e winEntry) bool {
	if len(sm.patterns) == 0 {
		return e.cfg.unitState == "enabled" || e.st.State != svc.Stopped || e.exit != 0
	}
	name := strings.ToLower(e.name)
	display := strings.ToLower(e.cfg.displayName)
	for _, p := range sm.patterns {
		if ok, _ := path.Match(p, name); ok {
			return true
		}
		if ok, _ := path.Match(p, display); ok {
			return true
		}
	}
	return false
}

func (sm *systemdManager) updateStats(g *winGroup) {
	s, ok := sm.stats[g.key]
	// Nouveau PID (redémarrage) : on repart de zéro pour ne pas calculer
	// un delta CPU négatif.
	if !ok || sm.pids[g.key] != g.pid {
		s = &systemd.Service{Name: g.key}
		sm.stats[g.key] = s
		sm.pids[g.key] = g.pid
	}
	s.State, s.Sub = winGroupState(g)

	if g.pid == 0 {
		s.Cpu, s.Mem = 0, 0
		return
	}
	p, err := process.NewProcess(int32(g.pid))
	if err != nil {
		return
	}
	if mi, err := p.MemoryInfo(); err == nil {
		s.Mem = mi.RSS
		if s.Mem > s.MemPeak {
			s.MemPeak = s.Mem
		}
	}
	if t, err := p.Times(); err == nil {
		// Même calcul que Linux (CPUUsageNSec) : cumul en nanosecondes.
		s.UpdateCPUPercent(uint64((t.User + t.System) * 1e9))
		if s.Cpu > s.CpuPeak {
			s.CpuPeak = s.Cpu
		}
	}
}

func winMapState(e winEntry) (systemd.ServiceState, systemd.ServiceSubState) {
	switch e.st.State {
	case svc.Running:
		return systemd.StatusActive, systemd.SubStateRunning
	case svc.StartPending, svc.ContinuePending:
		return systemd.StatusActivating, systemd.SubStateUnknown
	case svc.StopPending, svc.PausePending:
		return systemd.StatusDeactivating, systemd.SubStateUnknown
	case svc.Paused:
		return systemd.StatusInactive, systemd.SubStateUnknown
	case svc.Stopped:
		// Windows n'a pas d'état « failed » : on le déduit du code de sortie.
		if e.exit != 0 {
			return systemd.StatusFailed, systemd.SubStateFailed
		}
		return systemd.StatusInactive, systemd.SubStateDead
	}
	return systemd.StatusInactive, systemd.SubStateUnknown
}

func winGroupState(g *winGroup) (systemd.ServiceState, systemd.ServiceSubState) {
	state, sub := winMapState(g.members[0])
	for _, e := range g.members[1:] {
		st, ss := winMapState(e)
		if st == systemd.StatusActivating || st == systemd.StatusDeactivating {
			return st, ss
		}
		if st != state {
			state, sub = systemd.StatusActive, systemd.SubStateRunning
		}
	}
	return state, sub
}

func winExitCode(st svc.Status) uint32 {
	switch st.Win32ExitCode {
	case winErrServiceSpecific:
		return st.ServiceSpecificExitCode
	case winErrNeverStarted:
		return 0
	}
	return st.Win32ExitCode
}

func toWinSvcConfig(c mgr.Config) winSvcConfig {
	w := winSvcConfig{
		displayName: c.DisplayName,
		description: c.Description,
		binaryPath:  c.BinaryPathName,
		account:     c.ServiceStartName,
	}
	switch c.StartType {
	case mgr.StartAutomatic:
		w.unitState, w.startLabel = "enabled", "Automatic"
		if c.DelayedAutoStart {
			w.startLabel = "Automatic (Delayed Start)"
		}
	case mgr.StartManual:
		w.unitState, w.startLabel = "disabled", "Manual"
	case mgr.StartDisabled:
		w.unitState, w.startLabel = "disabled", "Disabled"
	default: // services de démarrage noyau / système
		w.unitState, w.startLabel = "enabled", "Boot"
	}
	return w
}

func winStateString(s systemd.ServiceState) string {
	switch s {
	case systemd.StatusActive:
		return "active"
	case systemd.StatusFailed:
		return "failed"
	case systemd.StatusActivating:
		return "activating"
	case systemd.StatusDeactivating:
		return "deactivating"
	}
	return "inactive"
}

func winSubString(s systemd.ServiceSubState) string {
	switch s {
	case systemd.SubStateRunning:
		return "running"
	case systemd.SubStateDead:
		return "dead"
	case systemd.SubStateFailed:
		return "failed"
	}
	return "unknown"
}

func winRawState(s svc.State) string {
	switch s {
	case svc.Stopped:
		return "Stopped"
	case svc.StartPending:
		return "Start Pending"
	case svc.StopPending:
		return "Stop Pending"
	case svc.Running:
		return "Running"
	case svc.ContinuePending:
		return "Continue Pending"
	case svc.PausePending:
		return "Pause Pending"
	case svc.Paused:
		return "Paused"
	}
	return "Unknown"
}

// Les clés reprennent celles de systemd (UnitFileState, Description,
// ActiveState...) pour que l'interface existante les affiche ; StartType
// porte le libellé Windows à côté.
func (sm *systemdManager) getServiceDetails(name string) (systemd.ServiceDetails, error) {
	sm.Lock()
	defer sm.Unlock()
	g, ok := sm.groups[name]
	if !ok {
		return nil, fmt.Errorf("service %q not found", name)
	}
	d := systemd.ServiceDetails{"Id": g.key}
	state, sub := winGroupState(g)
	d["ActiveState"] = winStateString(state)
	d["SubState"] = winSubString(sub)
	if g.pid != 0 {
		d["MainPID"] = g.pid
	}
	if s, ok := sm.stats[g.key]; ok {
		d["MemoryCurrent"] = s.Mem
		d["MemoryPeak"] = s.MemPeak
	}

	if len(g.members) == 1 {
		e := g.members[0]
		d["ServiceName"] = e.name
		d["DisplayName"] = e.cfg.displayName
		d["Description"] = e.cfg.displayName // clé lue par l'interface systemd
		d["LongDescription"] = e.cfg.description
		d["UnitFileState"] = e.cfg.unitState
		d["StartType"] = e.cfg.startLabel
		d["WindowsState"] = winRawState(e.st.State)
		d["ExecStart"] = e.cfg.binaryPath
		d["User"] = e.cfg.account
		d["ExitCode"] = e.exit
		if e.exit != 0 {
			d["Result"] = "exit-code"
		} else {
			d["Result"] = "success"
		}
		return d, nil
	}

	// Processus partagé : une ligne par service hébergé.
	d["Description"] = fmt.Sprintf("%s (processus partagé, PID %d)", g.image, g.pid)
	unitState, startLabel := "disabled", g.members[0].cfg.startLabel
	hosted := make([]map[string]any, 0, len(g.members))
	for _, e := range g.members {
		if e.cfg.unitState == "enabled" {
			unitState = "enabled"
		}
		if e.cfg.startLabel != startLabel {
			startLabel = "Mixed"
		}
		hosted = append(hosted, map[string]any{
			"ServiceName":     e.name,
			"DisplayName":     e.cfg.displayName,
			"LongDescription": e.cfg.description,
			"StartType":       e.cfg.startLabel,
			"UnitFileState":   e.cfg.unitState,
			"WindowsState":    winRawState(e.st.State),
		})
	}
	d["UnitFileState"] = unitState
	d["StartType"] = startLabel
	d["HostedServices"] = hosted
	if len(g.members) > 0 {
		d["ExecStart"] = g.members[0].cfg.binaryPath
		d["User"] = g.members[0].cfg.account
	}
	return d, nil
}
