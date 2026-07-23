// supervisor — the IDE host, stdlib router (no embedded Caddy).
//
// Discovers apps/*, host-routes <app>.localhost → that app's engine process, lazily
// spawning the engine on first request. Same job as the old Caddy version (PRD §3.2 /
// AGENT_SPEC §7) in ~150 lines of net/http, so the binary stays small and there's one
// config model — Go — instead of Caddy's admin API.
//
// MCP network mechanism (v0, per PRD §6.1 — the primary operate-mode interface):
//   - /mcp is the network-reachable tool surface; it carries a per-app bearer token.
//     /  and /api stay open for the local operator.
//   - REACH is a bind choice, not a rearchitecture:
//     LISTEN=127.0.0.1:8080  loopback only  → local MCP clients (Claude Desktop)  [default, most private]
//     LISTEN=0.0.0.0:8080    LAN            → a phone / other laptop MCP client
//     front the loopback listener with a tunnel (tailscale/ngrok/cloudflared) → web MCP clients
//     The bearer token is what makes binding beyond loopback safe.
//   - Streaming: FlushInterval=-1 + no write deadline, so MCP Streamable-HTTP/SSE isn't buffered or cut off.
//
// Not handled (deliberately): TLS/ACME. *.localhost is already a browser secure context,
// so v1 needs none. Add Caddy (or Go autocert) on :443 in front of this router only when
// real edge TLS arrives with v2 remote reach.
package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

type app struct {
	name  string
	dir   string
	port  int
	token string // per-app MCP bearer (AGENT_SPEC §7), persisted at agent/.mcp_token
	proxy *httputil.ReverseProxy

	start sync.Once
	mu    sync.Mutex
	cmd   *exec.Cmd // set once spawned, so we can kill it on shutdown
	ready bool
}

type router struct {
	engineBin string
	listen    string
	reg       map[string]*app // host ("sales.localhost") → app
	names     []string
}

func main() {
	engineBin := envOr("ENGINE_BIN", "./workspace")
	appsDir := envOr("APPS_DIR", "apps")
	listen := envOr("LISTEN", "127.0.0.1:8080") // see header: loopback → LAN → tunnel

	entries, err := os.ReadDir(appsDir)
	if err != nil {
		log.Fatalf("cannot read %s: %v", appsDir, err)
	}
	rt := &router{engineBin: engineBin, listen: listen, reg: map[string]*app{}}
	port := 8091
	for _, en := range entries {
		if !en.IsDir() {
			continue
		}
		name := en.Name()
		// "_"/"." prefixed folders are templates or scratch, not apps (see apps/_template).
		if strings.HasPrefix(name, "_") || strings.HasPrefix(name, ".") {
			continue
		}
		a := &app{name: name, dir: filepath.Join(appsDir, name), port: port, token: mcpToken(filepath.Join(appsDir, name))}
		target := &url.URL{Scheme: "http", Host: fmt.Sprintf("127.0.0.1:%d", a.port)}
		a.proxy = httputil.NewSingleHostReverseProxy(target)
		a.proxy.FlushInterval = -1 // stream immediately — required for MCP SSE / Streamable HTTP
		rt.reg[name+".localhost"] = a
		rt.names = append(rt.names, name)
		port++
		log.Printf("app %-12s ui http://%s.localhost%s · mcp http://localhost%s/mcp/%s · token apps/%s/agent/.mcp_token",
			name, name, portSuffix(listen), portSuffix(listen), name, name)
	}

	srv := &http.Server{
		Addr:         listen,
		Handler:      rt,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 0, // 0 = no write deadline: long-lived MCP SSE streams must not be cut off
	}

	go func() {
		log.Printf("supervisor (stdlib router) on %s · launcher http://ide.localhost%s",
			listen, portSuffix(listen))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	log.Println("shutting down: stopping engines…")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
	rt.stopEngines()
}

func (rt *router) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Path-routed MCP: http://localhost:8080/mcp/<app>
	//
	// This is the address to give an MCP client. Bare "localhost" resolves everywhere,
	// including Node's dns.lookup — "<app>.localhost" does NOT (browsers and curl map
	// *.localhost to loopback internally; Node returns ENOTFOUND), which otherwise forces
	// every operator to add an /etc/hosts entry with sudo just to connect a client.
	// Being bare localhost also means mcp-remote accepts plain HTTP without --allow-http.
	// Browsers keep using <app>.localhost for the UI, where the nicer hostname matters.
	if rest, ok := strings.CutPrefix(r.URL.Path, "/mcp/"); ok {
		name, _, _ := strings.Cut(rest, "/")
		a := rt.reg[name+".localhost"]
		if name == "" || a == nil {
			http.NotFound(w, r)
			return
		}
		if !rt.ensureUp(a) {
			http.Error(w, "engine failed to start", http.StatusBadGateway)
			return
		}
		if !authOK(r, a.token) {
			w.Header().Set("WWW-Authenticate", "Bearer")
			http.Error(w, "missing or invalid MCP bearer token", http.StatusUnauthorized)
			return
		}
		rr := r.Clone(r.Context())
		rr.URL.Path = "/mcp" // the engine only knows its own single endpoint
		a.proxy.ServeHTTP(w, rr)
		return
	}

	host := r.Host
	if i := strings.IndexByte(host, ':'); i >= 0 {
		host = host[:i] // strip port
	}
	a, ok := rt.reg[host]
	if !ok {
		rt.launcher(w) // ide.localhost + anything unmatched
		return
	}
	if !rt.ensureUp(a) {
		http.Error(w, "engine failed to start", http.StatusBadGateway)
		return
	}

	// Edge auth for the MCP surface only (AGENT_SPEC §7). The UI (/) and REST (/api)
	// stay open for the local operator; /mcp is the network-reachable tool surface.
	if strings.HasPrefix(r.URL.Path, "/mcp") && !authOK(r, a.token) {
		w.Header().Set("WWW-Authenticate", "Bearer")
		http.Error(w, "missing or invalid MCP bearer token", http.StatusUnauthorized)
		return
	}

	a.proxy.ServeHTTP(w, r)
}

// ensureUp lazily spawns the app's engine on first use (PRD §11: eager vs lazy → lazy)
// and reports whether it is serving.
func (rt *router) ensureUp(a *app) bool {
	a.start.Do(func() {
		cmd := startEngine(rt.engineBin, a.dir, a.port)
		a.mu.Lock()
		a.cmd = cmd
		a.mu.Unlock()
		a.ready = cmd != nil && waitReady(a.port, 20*time.Second)
	})
	return a.ready
}

func authOK(r *http.Request, token string) bool {
	got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	return subtle.ConstantTimeCompare([]byte(got), []byte(token)) == 1
}

// mcpToken loads (or generates + persists) the per-app bearer shown to the operator to
// paste into their harness's MCP config.
func mcpToken(appDir string) string {
	p := filepath.Join(appDir, "agent", ".mcp_token")
	if b, err := os.ReadFile(p); err == nil && len(strings.TrimSpace(string(b))) > 0 {
		return strings.TrimSpace(string(b))
	}
	buf := make([]byte, 24)
	_, _ = rand.Read(buf)
	tok := hex.EncodeToString(buf)
	_ = os.MkdirAll(filepath.Dir(p), 0o755)
	_ = os.WriteFile(p, []byte(tok), 0o600)
	return tok
}

func startEngine(bin, workspace string, port int) *exec.Cmd {
	cmd := exec.Command(bin)
	cmd.Env = append(os.Environ(), "WORKSPACE_DIR="+workspace, fmt.Sprintf("PORT=%d", port))
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	if err := cmd.Start(); err != nil {
		log.Printf("start engine for %s: %v", workspace, err)
		return nil
	}
	return cmd
}

func (rt *router) stopEngines() {
	for _, a := range rt.reg {
		a.mu.Lock()
		c := a.cmd
		a.mu.Unlock()
		if c != nil && c.Process != nil {
			_ = c.Process.Signal(syscall.SIGTERM)
		}
	}
}

func waitReady(port int, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if c, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 300*time.Millisecond); err == nil {
			c.Close()
			return true
		}
		time.Sleep(200 * time.Millisecond)
	}
	return false
}

func (rt *router) launcher(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	sfx := portSuffix(rt.listen)
	var b strings.Builder
	b.WriteString("<!doctype html><meta charset=utf-8><title>Workspace IDE</title>" +
		"<style>body{font:14px/1.6 system-ui;margin:2rem;max-width:46rem}" +
		"code{background:#f4f4f5;padding:.1rem .3rem;border-radius:3px}" +
		"li{margin:.6rem 0}</style><h1>Workspace IDE</h1><ul>")
	for _, name := range rt.names {
		fmt.Fprintf(&b,
			`<li><a href="http://%s.localhost%s/">%s</a> · <a href="http://%s.localhost%s/_/">admin</a>`+
				`<br><small>MCP <code>http://localhost%s/mcp/%s</code> — token in <code>apps/%s/agent/.mcp_token</code></small></li>`,
			name, sfx, name, name, sfx, sfx, name, name)
	}
	b.WriteString("</ul><p><small>Connect an MCP client to the address above; it is bare " +
		"<code>localhost</code> on purpose, so no hosts-file entry is needed.</small></p>")
	_, _ = w.Write([]byte(b.String()))
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

// portSuffix returns ":8080" for a listen addr like "127.0.0.1:8080" (":80" omitted so
// links stay clean when bound to the default HTTP port).
func portSuffix(listen string) string {
	i := strings.LastIndexByte(listen, ':')
	if i < 0 {
		return ""
	}
	if p := listen[i:]; p != ":80" {
		return p
	}
	return ""
}
