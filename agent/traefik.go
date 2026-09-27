package agent

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net/http"
	"os"
	posixpath "path"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/fxamacker/cbor/v2"
	"github.com/henrygd/beszel/agent/utils"
	"github.com/henrygd/beszel/internal/entities/system"
	"gopkg.in/yaml.v3"
)

// Traefik instances of the host: in containers, found through Docker, or run
// as a service with /etc/traefik or the files of TRAEFIK_CONFIG. Their static configuration is read from the
// file, environment and arguments of the container, their routes from the
// labels of the containers and the files of the file provider, and their
// certificates from the storage of their ACME resolvers (acme.json).

const (
	// maxTraefikFileSize skips configuration and acme.json files too large to read.
	maxTraefikFileSize = 8 << 20
	// traefikLogTail is the size of the end of a log file read.
	traefikLogTail = 256 << 10
	// traefikLogLines caps the lines of a log returned to the hub.
	traefikLogLines = 400
)

// traefikServiceConfigs are the static configuration files of a Traefik run as a service.
var traefikServiceConfigs = []string{"/etc/traefik/traefik.yml", "/etc/traefik/traefik.yaml"}

// hostMatcher finds the names of the Host() and HostSNI() matchers of a rule.
var hostMatcher = regexp.MustCompile("Host(?:SNI)?\\(([^)]*)\\)")

var backtickValue = regexp.MustCompile("`([^`]+)`")

// traefikSource is an instance with its settings, to read its files.
type traefikSource struct {
	instance system.TraefikInstance
	// settings are the static settings, keys in lower case and dotted ("api.insecure").
	settings map[string]string
	mounts   []traefikMount
}

type traefikMount struct {
	Source      string
	Destination string
}

// hostPath gives the path on the host of a path in the container, through the
// deepest mount holding it. For a service, the path itself, a relative one
// being relative to the directory of its configuration file.
func (src *traefikSource) hostPath(path string) string {
	if path == "" {
		return ""
	}
	if src.instance.Id == "" {
		if !filepath.IsAbs(path) && src.instance.ConfigFile != "" {
			return filepath.Join(filepath.Dir(src.instance.ConfigFile), path)
		}
		return path
	}
	// the paths of a container are POSIX ones, whatever the host
	path = posixpath.Clean("/" + path)
	best := -1
	for i, mount := range src.mounts {
		dest := strings.TrimSuffix(mount.Destination, "/")
		if (path == dest || strings.HasPrefix(path, dest+"/")) && (best < 0 || len(dest) > len(src.mounts[best].Destination)) {
			best = i
		}
	}
	if best < 0 {
		return ""
	}
	mount := src.mounts[best]
	return filepath.Join(mount.Source, strings.TrimPrefix(path, strings.TrimSuffix(mount.Destination, "/")))
}

type dockerContainerSummary struct {
	Id     string
	Names  []string
	Image  string
	State  string
	Status string
	Labels map[string]string
}

type dockerContainerInspect struct {
	Args   []string
	Config struct {
		Env    []string
		Labels map[string]string
	}
	Mounts          []traefikMount
	NetworkSettings struct {
		Ports map[string][]struct {
			HostIp   string
			HostPort string
		}
	}
}

// dockerGet decodes the answer of the Docker API to a GET request.
func (dm *dockerManager) dockerGet(ctx context.Context, endpoint string, dest any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	resp, err := dm.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("%s: %s", resp.Status, strings.TrimSpace(string(body)))
	}
	return json.NewDecoder(resp.Body).Decode(dest)
}

// isTraefikImage tells an image of Traefik, such as "traefik:v3.1" or "docker.io/library/traefik".
func isTraefikImage(image string) bool {
	name := strings.ToLower(image)
	name = name[strings.LastIndex(name, "/")+1:]
	if i := strings.IndexAny(name, ":@"); i >= 0 {
		name = name[:i]
	}
	return name == "traefik"
}

// imageVersion gives the tag of an image, such as "v3.1" of "traefik:v3.1".
func imageVersion(image string) string {
	image = strings.SplitN(image, "@", 2)[0]
	if i := strings.LastIndex(image, ":"); i > strings.LastIndex(image, "/") {
		return image[i+1:]
	}
	return ""
}

// discoverTraefik finds the Traefik instances of the host. The containers of
// the host are returned too, for the routes defined by their labels.
func discoverTraefik(ctx context.Context, dm *dockerManager) ([]*traefikSource, []dockerContainerSummary) {
	var sources []*traefikSource
	var containers []dockerContainerSummary
	if dm != nil && dm.client != nil {
		if err := dm.dockerGet(ctx, "http://localhost/containers/json", &containers); err != nil {
			logCertificateError("traefik containers", err)
		}
		for _, ctr := range containers {
			if !isTraefikImage(ctr.Image) {
				continue
			}
			var inspect dockerContainerInspect
			endpoint, err := buildDockerContainerEndpoint(ctr.Id, "json", nil)
			if err == nil {
				err = dm.dockerGet(ctx, endpoint, &inspect)
			}
			sources = append(sources, containerTraefik(ctr, inspect, err))
		}
	}
	// the configuration files of the Traefik run as services, given to the agent
	if files, ok := utils.GetEnv("TRAEFIK_CONFIG"); ok {
		for file := range strings.SplitSeq(files, ",") {
			if file = strings.TrimSpace(file); file != "" {
				src := serviceTraefik(file)
				if strings.Contains(files, ",") {
					src.instance.Name = "traefik (" + filepath.Base(filepath.Dir(file)) + ")"
				}
				sources = append(sources, src)
			}
		}
		return sources, containers
	}
	if len(sources) == 0 && runtime.GOOS != "windows" {
		for _, file := range traefikServiceConfigs {
			if _, err := os.Stat(file); err == nil {
				sources = append(sources, serviceTraefik(file))
				break
			}
		}
	}
	return sources, containers
}

// containerTraefik reads the configuration of a Traefik container.
func containerTraefik(ctr dockerContainerSummary, inspect dockerContainerInspect, inspectErr error) *traefikSource {
	name := ctr.Id
	if len(ctr.Names) > 0 {
		name = strings.TrimPrefix(ctr.Names[0], "/")
	}
	src := &traefikSource{
		instance: system.TraefikInstance{
			Id:      ctr.Id,
			Name:    name,
			Image:   ctr.Image,
			Version: imageVersion(ctr.Image),
			State:   ctr.State,
			Status:  ctr.Status,
		},
		settings: map[string]string{},
		mounts:   inspect.Mounts,
	}
	if inspectErr != nil {
		src.instance.Error = inspectErr.Error()
		return src
	}
	args := traefikArgs(inspect.Args)
	// the configuration file given in the arguments, or the default ones
	files := []string{"/etc/traefik/traefik.yml", "/etc/traefik/traefik.yaml", "/traefik.yml", "/traefik.yaml"}
	if file := args["configfile"]; file != "" {
		files = []string{file}
	}
	for _, file := range files {
		hostFile := src.hostPath(file)
		if hostFile == "" {
			continue
		}
		if err := readYAMLSettings(hostFile, "", src.settings); err == nil {
			src.instance.ConfigFile = hostFile
			break
		} else if !errors.Is(err, os.ErrNotExist) {
			src.instance.Error = err.Error()
		}
	}
	// the environment, then the arguments, win over the file
	for _, env := range inspect.Config.Env {
		key, value, _ := strings.Cut(env, "=")
		if rest, ok := strings.CutPrefix(key, "TRAEFIK_"); ok {
			src.settings[strings.ToLower(strings.ReplaceAll(rest, "_", "."))] = value
		}
	}
	for key, value := range args {
		src.settings[key] = value
	}
	// the insecure API is published on the port of the traefik entry point of the container
	if src.settings["api.insecure"] == "true" {
		for _, binding := range inspect.NetworkSettings.Ports[strconv.Itoa(int(src.apiPort()))+"/tcp"] {
			if port, err := strconv.ParseUint(binding.HostPort, 10, 16); err == nil {
				src.instance.DashboardPort = uint16(port)
				break
			}
		}
	}
	return src
}

// serviceTraefik reads the configuration of a Traefik run as a service.
func serviceTraefik(file string) *traefikSource {
	src := &traefikSource{
		instance: system.TraefikInstance{Name: "traefik", ConfigFile: file},
		settings: map[string]string{},
	}
	if err := readYAMLSettings(file, "", src.settings); err != nil {
		src.instance.Error = err.Error()
	}
	if src.settings["api.insecure"] == "true" {
		src.instance.DashboardPort = src.apiPort()
	}
	return src
}

// apiPort is the port of the traefik entry point, serving the insecure API: 8080 by default.
func (src *traefikSource) apiPort() uint16 {
	address := src.settings["entrypoints.traefik.address"]
	if i := strings.LastIndex(address, ":"); i >= 0 {
		if port, err := strconv.ParseUint(address[i+1:], 10, 16); err == nil {
			return uint16(port)
		}
	}
	return 8080
}

// traefikArgs reads the "--key=value" arguments of Traefik, keys in lower case.
func traefikArgs(args []string) map[string]string {
	settings := map[string]string{}
	for _, arg := range args {
		if !strings.HasPrefix(arg, "-") {
			continue
		}
		key, value, found := strings.Cut(strings.TrimLeft(arg, "-"), "=")
		if !found {
			value = "true"
		}
		settings[strings.ToLower(key)] = value
	}
	return settings
}

// readYAMLSettings adds the settings of a YAML file to settings, as dotted keys in lower case.
func readYAMLSettings(file, prefix string, settings map[string]string) error {
	info, err := os.Stat(file)
	if err != nil {
		return err
	}
	if info.Size() > maxTraefikFileSize {
		return fmt.Errorf("%s: too large", file)
	}
	data, err := os.ReadFile(file)
	if err != nil {
		return certFileError(err)
	}
	var root any
	if err := yaml.Unmarshal(data, &root); err != nil {
		return fmt.Errorf("%s: %w", file, err)
	}
	flattenSettings(prefix, root, settings)
	return nil
}

// flattenSettings writes the leaves of a YAML tree as dotted keys: lists get their index.
func flattenSettings(prefix string, node any, settings map[string]string) {
	join := func(key string) string {
		if prefix == "" {
			return key
		}
		return prefix + "." + key
	}
	switch value := node.(type) {
	case map[string]any:
		if len(value) == 0 && prefix != "" {
			settings[prefix] = "true"
		}
		for key, child := range value {
			flattenSettings(join(strings.ToLower(key)), child, settings)
		}
	case []any:
		for i, child := range value {
			flattenSettings(join(strconv.Itoa(i)), child, settings)
		}
	case nil:
		if prefix != "" {
			settings[prefix] = "true"
		}
	default:
		settings[prefix] = fmt.Sprint(value)
	}
}

// hasSection tells whether a section is enabled, such as "accesslog": set to
// true, or with settings under it.
func hasSection(settings map[string]string, section string) bool {
	if value, ok := settings[section]; ok {
		return value != "false"
	}
	for key := range settings {
		if strings.HasPrefix(key, section+".") {
			return true
		}
	}
	return false
}

// describe completes the instance: its logs, resolvers, routes and dashboard.
func (src *traefikSource) describe(containers []dockerContainerSummary) {
	inst := &src.instance
	settings := src.settings
	logFile := func(key string) string {
		if path := settings[key]; path != "" {
			if host := src.hostPath(path); host != "" {
				return "file:" + host
			}
		}
		if inst.Id != "" {
			return "stdout"
		}
		return ""
	}
	inst.Log = logFile("log.filepath")
	if hasSection(settings, "accesslog") {
		inst.AccessLog = logFile("accesslog.filepath")
	}

	// the ACME resolvers and the certificates of their storage
	names := map[string]bool{}
	for key := range settings {
		if rest, ok := strings.CutPrefix(key, "certificatesresolvers."); ok {
			names[strings.SplitN(rest, ".", 2)[0]] = true
		}
	}
	for _, name := range slices.Sorted(maps.Keys(names)) {
		resolver := system.TraefikResolver{Name: name}
		storage := settings["certificatesresolvers."+name+".acme.storage"]
		if storage == "" {
			storage = "acme.json"
		}
		// the working directory of the image is the root of the container
		if src.instance.Id != "" && !strings.HasPrefix(storage, "/") {
			storage = "/" + storage
		}
		resolver.Storage = src.hostPath(storage)
		if resolver.Storage == "" {
			resolver.Error = storage + ": not mounted from the host"
		} else if certs, err := readAcmeStorage(resolver.Storage); err != nil {
			resolver.Error = err.Error()
		} else {
			resolver.Certificates = len(certs[name])
		}
		inst.Resolvers = append(inst.Resolvers, resolver)
	}

	// the routes of the docker provider: labels of the containers
	for _, ctr := range containers {
		if ctr.Labels["traefik.enable"] == "false" {
			continue
		}
		labels := map[string]string{}
		for key, value := range ctr.Labels {
			if rest, ok := strings.CutPrefix(strings.ToLower(key), "traefik."); ok {
				labels[rest] = value
			}
		}
		name := ctr.Id
		if len(ctr.Names) > 0 {
			name = strings.TrimPrefix(ctr.Names[0], "/")
		}
		inst.Routes = append(inst.Routes, traefikRoutes(labels, name, "docker")...)
	}
	// the routes of the file provider
	for _, file := range src.dynamicFiles() {
		dynamic := map[string]string{}
		if readYAMLSettings(file, "", dynamic) == nil {
			inst.Routes = append(inst.Routes, traefikRoutes(dynamic, "", "file")...)
		}
	}
	slices.SortFunc(inst.Routes, func(a, b system.TraefikRoute) int { return strings.Compare(a.Router, b.Router) })

	// the dashboard through a router to the API
	for _, route := range inst.Routes {
		if route.Service == "api@internal" && len(route.Hosts) > 0 {
			scheme := "http"
			if route.TLS {
				scheme = "https"
			}
			inst.Dashboard = scheme + "://" + route.Hosts[0] + "/dashboard/"
			break
		}
	}
}

// dynamicFiles are the files of the file provider, on the host.
func (src *traefikSource) dynamicFiles() []string {
	var files []string
	if file := src.settings["providers.file.filename"]; file != "" {
		if host := src.hostPath(file); host != "" {
			files = append(files, host)
		}
	}
	if dir := src.settings["providers.file.directory"]; dir != "" {
		if host := src.hostPath(dir); host != "" {
			for _, pattern := range []string{"*.yml", "*.yaml"} {
				found, _ := filepath.Glob(filepath.Join(host, pattern))
				files = append(files, found...)
			}
		}
	}
	return files
}

// traefikRoutes reads the HTTP routers of dynamic settings (labels without their "traefik." prefix).
func traefikRoutes(settings map[string]string, container, provider string) []system.TraefikRoute {
	routers := map[string]*system.TraefikRoute{}
	for key, value := range settings {
		rest, ok := strings.CutPrefix(key, "http.routers.")
		if !ok {
			continue
		}
		name, field, _ := strings.Cut(rest, ".")
		route := routers[name]
		if route == nil {
			route = &system.TraefikRoute{Router: name, Container: container, Provider: provider}
			routers[name] = route
		}
		switch {
		case field == "rule":
			route.Rule = value
			for _, matcher := range hostMatcher.FindAllStringSubmatch(value, -1) {
				for _, host := range backtickValue.FindAllStringSubmatch(matcher[1], -1) {
					route.Hosts = append(route.Hosts, host[1])
				}
			}
		case field == "tls":
			route.TLS = route.TLS || value == "true"
		case field == "tls.certresolver":
			route.TLS = true
			route.Resolver = value
		case strings.HasPrefix(field, "tls."):
			route.TLS = true
		case field == "entrypoints" || strings.HasPrefix(field, "entrypoints."):
			for _, entry := range strings.Split(value, ",") {
				if entry = strings.TrimSpace(entry); entry != "" {
					route.EntryPoints = append(route.EntryPoints, entry)
				}
			}
		case field == "service":
			route.Service = value
		}
	}
	routes := make([]system.TraefikRoute, 0, len(routers))
	for _, route := range routers {
		if route.Rule != "" {
			routes = append(routes, *route)
		}
	}
	return routes
}

// acmeCertificate is a certificate of an ACME storage (acme.json of Traefik 2 and 3).
type acmeCertificate struct {
	Domain struct {
		Main string   `json:"main"`
		Sans []string `json:"sans"`
	} `json:"domain"`
	Certificate string `json:"certificate"`
}

// readAcmeStorage reads the certificates of an acme.json file, by resolver.
func readAcmeStorage(path string) (map[string][]acmeCertificate, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, certFileError(err)
	}
	if info.Size() > maxTraefikFileSize {
		return nil, fmt.Errorf("%s: too large", path)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, certFileError(err)
	}
	var storage map[string]struct {
		Certificates []acmeCertificate `json:"certificates"`
	}
	if err := json.Unmarshal(data, &storage); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	certs := map[string][]acmeCertificate{}
	for resolver, content := range storage {
		certs[strings.ToLower(resolver)] = content.Certificates
	}
	return certs, nil
}

// discoverTraefikCertificates adds the certificates served by the Traefik
// instances: the ones of their ACME resolvers and of their file provider.
func discoverTraefikCertificates(ctx context.Context, dm *dockerManager, inv *certInventory) {
	sources, _ := discoverTraefik(ctx, dm)
	for _, src := range sources {
		src.describe(nil)
		for _, resolver := range src.instance.Resolvers {
			if resolver.Storage == "" || resolver.Error != "" {
				continue
			}
			storage, _ := readAcmeStorage(resolver.Storage)
			for _, acme := range storage[resolver.Name] {
				pemData, err := base64.StdEncoding.DecodeString(acme.Certificate)
				if err != nil {
					continue
				}
				parsed, err := parseCertificate(pemData)
				if err != nil {
					continue
				}
				cert := certificateOf(parsed)
				cert.Key = "traefik:" + resolver.Storage + "#" + acme.Domain.Main
				cert.Path = resolver.Storage
				inv.add(cert, &system.CertificateUse{
					Kind:     system.CertUseTraefik,
					Location: resolver.Storage,
					Detail:   src.instance.Name + " · ACME " + resolver.Name,
				})
			}
		}
		// the certificate files of the file provider
		for _, file := range src.dynamicFiles() {
			dynamic := map[string]string{}
			if readYAMLSettings(file, "", dynamic) != nil {
				continue
			}
			for key, value := range dynamic {
				if strings.HasPrefix(key, "tls.certificates.") && strings.HasSuffix(key, ".certfile") {
					if host := src.hostPath(value); host != "" {
						inv.addFile(host, system.CertificateUse{Kind: system.CertUseTraefik, Location: file, Detail: src.instance.Name})
					}
				}
			}
		}
	}
}

// GetTraefikHandler returns the Traefik instances of the host.
type GetTraefikHandler struct{}

func (h *GetTraefikHandler) Handle(hctx *HandlerContext) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	sources, containers := discoverTraefik(ctx, hctx.Agent.dockerManager)
	instances := make([]system.TraefikInstance, 0, len(sources))
	for _, src := range sources {
		src.describe(containers)
		instances = append(instances, src.instance)
	}
	return hctx.SendResponse(system.TraefikResponse{Instances: instances}, hctx.RequestID)
}

// GetTraefikLogHandler returns the last lines of the log or access log of a
// Traefik instance: its file, or the output of its container.
type GetTraefikLogHandler struct{}

func (h *GetTraefikLogHandler) Handle(hctx *HandlerContext) error {
	var req system.TraefikLogRequest
	if err := cbor.Unmarshal(hctx.Request.Data, &req); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	sources, _ := discoverTraefik(ctx, hctx.Agent.dockerManager)
	idx := slices.IndexFunc(sources, func(src *traefikSource) bool { return src.instance.Name == req.Instance })
	if idx < 0 {
		return fmt.Errorf("traefik instance %q not found", req.Instance)
	}
	src := sources[idx]
	src.describe(nil)
	source := src.instance.Log
	if req.Access {
		source = src.instance.AccessLog
	}
	var response system.TraefikLogResponse
	switch {
	case strings.HasPrefix(source, "file:"):
		path := strings.TrimPrefix(source, "file:")
		lines, err := tailFile(path)
		if err != nil {
			return err
		}
		response = system.TraefikLogResponse{Lines: lines, Source: path}
	case source == "stdout" && hctx.Agent.dockerManager != nil:
		output, err := hctx.Agent.dockerManager.getLogs(ctx, src.instance.Id)
		if err != nil {
			return err
		}
		// the access lines and the other lines share the output of the container
		var kept []string
		for line := range strings.SplitSeq(output, "\n") {
			if line != "" && isAccessLine(line) == req.Access {
				kept = append(kept, line)
			}
		}
		response = system.TraefikLogResponse{Lines: strings.Join(kept, "\n"), Source: "stdout"}
	default:
		return errors.New("log not enabled")
	}
	return hctx.SendResponse(response, hctx.RequestID)
}

// isAccessLine tells a line of access log: common log format or JSON with the request.
func isAccessLine(line string) bool {
	if strings.Contains(line, `"RequestMethod"`) {
		return true
	}
	for _, method := range []string{`"GET `, `"POST `, `"PUT `, `"DELETE `, `"HEAD `, `"PATCH `, `"OPTIONS `} {
		if strings.Contains(line, method) {
			return true
		}
	}
	return false
}

// tailFile reads the last lines of a file.
func tailFile(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", certFileError(err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return "", err
	}
	offset := max(info.Size()-traefikLogTail, 0)
	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		return "", err
	}
	data, err := io.ReadAll(file)
	if err != nil {
		return "", err
	}
	if offset > 0 {
		// the first line is cut
		if i := bytes.IndexByte(data, '\n'); i >= 0 {
			data = data[i+1:]
		}
	}
	lines := strings.Split(strings.TrimRight(string(data), "\n"), "\n")
	if len(lines) > traefikLogLines {
		lines = lines[len(lines)-traefikLogLines:]
	}
	return strings.Join(lines, "\n"), nil
}
