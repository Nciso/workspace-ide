// engine — one binary that serves a single app folder.
//
//   - the operator UI (embedded shadcn SPA) at  /
//   - the PocketBase REST API at                /api/*
//   - the build-mode admin dashboard at         /_/   (PocketBase)
//   - the app manifest at                       /manifest
//   - generated agent tools (browser)  at       /agent/tools
//   - the per-app MCP server at                 /mcp
//
// The app folder is the source of truth: schema in <app>/pb_migrations, data in
// <app>/pb_data (gitignored), the agent in <app>/agent (policy.json + instructions.md).
// The supervisor runs one of these per apps/* folder; see cmd/supervisor.
package main

import (
	"bytes"
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/jsvm"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"
)

//go:embed all:ui/dist
var uiDist embed.FS

func main() {
	// Resolve the app folder. Default ./apps/sales; override with WORKSPACE_DIR.
	workspaceDir := "apps/sales"
	if v := os.Getenv("WORKSPACE_DIR"); v != "" {
		workspaceDir = v
	}
	abs, err := filepath.Abs(workspaceDir)
	if err != nil {
		log.Fatal(err)
	}

	// Convenience: with no subcommand, default to `serve` on $PORT so the supervisor
	// (and later Caddy/portless) can launch an engine by injecting PORT alone.
	if len(os.Args) == 1 {
		port := os.Getenv("PORT")
		if port == "" {
			port = "8090"
		}
		os.Args = append(os.Args, "serve", "--http", "127.0.0.1:"+port)
	}

	app := pocketbase.NewWithConfig(pocketbase.Config{
		DefaultDataDir: filepath.Join(abs, "pb_data"),
	})

	migrationsDir := filepath.Join(abs, "pb_migrations")
	hooksDir := filepath.Join(abs, "pb_hooks")

	// Load JS migrations + hooks from the app folder.
	jsvm.MustRegister(app, jsvm.Config{
		MigrationsDir: migrationsDir,
		HooksDir:      hooksDir,
	})

	// Apply pending migrations automatically on boot.
	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{
		Dir:         migrationsDir,
		Automigrate: true,
	})

	// Ensure a default superuser (admin) exists so the build-mode dashboard at /_/ is
	// reachable out of the box. Configurable via SUPERUSER_EMAIL / SUPERUSER_PASSWORD;
	// created only if missing, never overwritten. With no password set we generate a
	// random one and print it once, rather than shipping a known default credential.
	adminEmail := envOr("SUPERUSER_EMAIL", "admin@example.com")
	adminPass, generatedPass := os.Getenv("SUPERUSER_PASSWORD"), false
	if adminPass == "" {
		adminPass, generatedPass = randomSecret(12), true
	}
	app.OnBootstrap().BindFunc(func(e *core.BootstrapEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		ensureSuperuser(e.App, adminEmail, adminPass, generatedPass)
		return nil
	})

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		// Manifest — what the generic renderer and harnesses discover about this app.
		se.Router.GET("/manifest", func(e *core.RequestEvent) error {
			return e.JSON(200, buildManifest(app, workspaceDir))
		})

		// Generated agent tools, for the in-browser (WebLLM) function-calling consumer.
		se.Router.GET("/agent/tools", func(e *core.RequestEvent) error {
			return e.JSON(200, map[string]any{"tools": buildTools(app, abs)})
		})

		// The per-app MCP server (minimal JSON-RPC), for operational harnesses.
		se.Router.POST("/mcp", func(e *core.RequestEvent) error {
			return handleMCP(e, app, abs)
		})

		// Serve the embedded operator UI at the root, with SPA fallback.
		sub, err := fs.Sub(uiDist, "ui/dist")
		if err != nil {
			return err
		}
		se.Router.GET("/{path...}", apis.Static(sub, true))
		return se.Next()
	})

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}

// ---- agent policy -----------------------------------------------------------

type collPolicy struct {
	Read   bool `json:"read"`
	Create bool `json:"create"`
	Update bool `json:"update"`
	Delete bool `json:"delete"`
}

type policy struct {
	Defaults    collPolicy            `json:"defaults"`
	Collections map[string]collPolicy `json:"collections"`
}

func loadPolicy(workspaceAbs string) policy {
	var p policy
	if b, err := os.ReadFile(filepath.Join(workspaceAbs, "agent", "policy.json")); err == nil {
		_ = json.Unmarshal(b, &p)
	}
	return p
}

// ---- tool generation (policy + PocketBase schema) ---------------------------

func jsonType(pbType string) string {
	switch pbType {
	case "number":
		return "number"
	case "bool":
		return "boolean"
	case "json":
		return "object"
	default:
		return "string"
	}
}

// writableFields returns the non-system, agent-settable fields of a collection.
func writableFields(app core.App, name string) map[string]string {
	out := map[string]string{}
	c, err := app.FindCollectionByNameOrId(name)
	if err != nil || c == nil {
		return out
	}
	for _, f := range c.Fields {
		n := f.GetName()
		if n == "id" || f.Type() == "autodate" {
			continue
		}
		out[n] = f.Type()
	}
	return out
}

// fieldSchema derives a tool argument schema from one PocketBase field, and reports
// whether the field is required. Every field type marshals itself together with its own
// options ("values", "maxSelect", "required", …), so reading that JSON keeps this generic
// instead of a type switch per field kind.
//
// Advertising `enum` for select fields is load-bearing: without it a caller only sees
// "string" and has to guess the vocabulary, and every guess that misses the exact value
// is rejected by the collection as "Invalid value x" (AGENT_SPEC §4.1: select→enum).
func fieldSchema(app core.App, f core.Field) (map[string]any, bool) {
	var opts map[string]any
	if b, err := json.Marshal(f); err == nil {
		_ = json.Unmarshal(b, &opts)
	}
	required, _ := opts["required"].(bool)

	item := map[string]any{"type": jsonType(f.Type())}
	switch f.Type() {
	case "select":
		if vals, ok := opts["values"].([]any); ok && len(vals) > 0 {
			item["enum"] = vals
		}
	case "relation":
		target := "a related record"
		if cid, ok := opts["collectionId"].(string); ok {
			if rc, err := app.FindCollectionByNameOrId(cid); err == nil && rc != nil {
				target = "a " + rc.Name + " record"
			}
		}
		item["description"] = "id of " + target
	case "date":
		item["description"] = "UTC datetime, e.g. 2026-07-23 09:00:00"
	}

	// Multi-valued fields (maxSelect > 1) take a list, not a scalar.
	if mv, ok := f.(core.MultiValuer); ok && mv.IsMultiple() {
		return map[string]any{"type": "array", "items": item}, required
	}
	return item, required
}

// fieldProps returns the JSON Schema properties for a collection's agent-settable fields,
// plus the names of the ones the collection insists on.
func fieldProps(app core.App, name string) (map[string]any, []string) {
	props := map[string]any{}
	required := []string{}
	c, err := app.FindCollectionByNameOrId(name)
	if err != nil || c == nil {
		return props, required
	}
	for _, f := range c.Fields {
		n := f.GetName()
		if n == "id" || f.Type() == "autodate" {
			continue
		}
		schema, req := fieldSchema(app, f)
		props[n] = schema
		if req {
			required = append(required, n)
		}
	}
	return props, required
}

func buildTools(app core.App, workspaceAbs string) []map[string]any {
	p := loadPolicy(workspaceAbs)
	tools := []map[string]any{}
	idSchema := map[string]any{
		"type":       "object",
		"properties": map[string]any{"id": map[string]any{"type": "string"}},
		"required":   []string{"id"},
	}
	for name, rule := range p.Collections {
		if rule.Read {
			tools = append(tools,
				map[string]any{
					"name": "list_" + name,
					"description": "List records from the " + name + " collection. Use `filter` to look a " +
						"record up instead of paging through everything.",
					"inputSchema": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"filter": map[string]any{
								"type": "string",
								"description": `PocketBase filter expression, e.g. jaro_user_id = "u_8812" ` +
									`or status = "Draft" && due_at < "2026-07-24".`,
							},
							"sort": map[string]any{
								"type":        "string",
								"description": "Sort expression, e.g. -created or last_pinged_at.",
							},
							"limit": map[string]any{"type": "integer", "description": "Max records (default 50)."},
						},
					},
				},
				map[string]any{
					"name":        "get_" + name,
					"description": "Get a single " + name + " record by id.",
					"inputSchema": idSchema,
				},
			)
		}
		if rule.Create {
			props, required := fieldProps(app, name)
			tools = append(tools, map[string]any{
				"name":        "create_" + name,
				"description": "Create a record in the " + name + " collection.",
				"inputSchema": map[string]any{"type": "object", "properties": props, "required": required},
			})
		}
		if rule.Update {
			props, _ := fieldProps(app, name)
			props["id"] = map[string]any{"type": "string"}
			// Updates are partial: only the id is mandatory, never the collection's
			// required fields — those are already satisfied by the stored record.
			tools = append(tools, map[string]any{
				"name":        "update_" + name,
				"description": "Update fields of a " + name + " record by id.",
				"inputSchema": map[string]any{"type": "object", "properties": props, "required": []string{"id"}},
			})
		}
		if rule.Delete {
			tools = append(tools, map[string]any{
				"name":        "delete_" + name,
				"description": "Delete a " + name + " record by id.",
				"inputSchema": idSchema,
			})
		}
	}
	return tools
}

// ---- manifest ---------------------------------------------------------------

func buildManifest(app core.App, workspaceDir string) map[string]any {
	collections := []map[string]any{}
	if cols, err := app.FindAllCollections(); err == nil {
		for _, c := range cols {
			if c.System || c.Type != "base" {
				continue
			}
			fields := []map[string]any{}
			for _, f := range c.Fields {
				if f.GetName() == "id" {
					continue
				}
				fd := map[string]any{"name": f.GetName(), "type": f.Type()}
				// A board view builds one column per select option, so the renderer
				// needs the vocabulary, not just the type.
				if f.Type() == "select" {
					var opts map[string]any
					if b, err := json.Marshal(f); err == nil {
						_ = json.Unmarshal(b, &opts)
					}
					if vals, ok := opts["values"].([]any); ok {
						fd["values"] = vals
					}
				}
				fields = append(fields, fd)
			}
			collections = append(collections, map[string]any{"name": c.Name, "fields": fields})
		}
	}
	m := map[string]any{
		"name":        filepath.Base(workspaceDir),
		"collections": collections,
	}
	// views.json is authored per app, like the schema and the policy — the UI renders
	// whatever it describes, so adding a view never means rebuilding the bundle.
	if v := loadViews(workspaceDir); v != nil {
		if name, ok := v["name"].(string); ok && name != "" {
			m["name"] = name
		}
		m["views"] = v["views"]
	}
	return m
}

// loadViews reads the app's authored view spec; a missing or malformed file just means
// the UI falls back to rendering a plain table per collection.
func loadViews(workspaceDir string) map[string]any {
	b, err := os.ReadFile(filepath.Join(workspaceDir, "views.json"))
	if err != nil {
		return nil
	}
	var v map[string]any
	if err := json.Unmarshal(b, &v); err != nil {
		log.Printf("views.json: %v (ignored)", err)
		return nil
	}
	return v
}

// ---- minimal MCP server -----------------------------------------------------

func handleMCP(e *core.RequestEvent, app core.App, workspaceAbs string) error {
	var req struct {
		Jsonrpc string          `json:"jsonrpc"`
		ID      any             `json:"id"`
		Method  string          `json:"method"`
		Params  json.RawMessage `json:"params"`
	}
	if err := e.BindBody(&req); err != nil {
		return e.JSON(200, rpcError(nil, -32700, "parse error"))
	}

	switch {
	case req.Method == "initialize":
		instr, _ := os.ReadFile(filepath.Join(workspaceAbs, "agent", "instructions.md"))
		return e.JSON(200, rpcOK(req.ID, map[string]any{
			"protocolVersion": "2024-11-05",
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]any{"name": filepath.Base(workspaceAbs), "version": "0.0.1"},
			"instructions":    string(instr),
		}))

	case req.Method == "tools/list":
		return e.JSON(200, rpcOK(req.ID, map[string]any{"tools": buildTools(app, workspaceAbs)}))

	case req.Method == "tools/call":
		var pr struct {
			Name      string         `json:"name"`
			Arguments map[string]any `json:"arguments"`
		}
		_ = json.Unmarshal(req.Params, &pr)
		text, err := callTool(app, workspaceAbs, pr.Name, pr.Arguments)
		if err != nil {
			return e.JSON(200, rpcOK(req.ID, map[string]any{
				"isError": true,
				"content": []map[string]any{{"type": "text", "text": err.Error()}},
			}))
		}
		return e.JSON(200, rpcOK(req.ID, map[string]any{
			"content": []map[string]any{{"type": "text", "text": text}},
		}))

	case strings.HasPrefix(req.Method, "notifications/"):
		return e.NoContent(202)

	default:
		return e.JSON(200, rpcError(req.ID, -32601, "method not found: "+req.Method))
	}
}

// callTool enforces the agent policy, then executes through the app's OWN REST API over
// loopback — the same enforcement path a UI write hits (collection rules, validation,
// request hooks) — rather than a raw ORM call. Schema introspection stays in-process
// (read-only); only the data operation crosses /api. See PRD §6.1 / AGENT_SPEC §7.
func callTool(app core.App, workspaceAbs, name string, args map[string]any) (string, error) {
	p := loadPolicy(workspaceAbs)
	base := apiBase()
	recordURL := func(coll, id string) string {
		u := fmt.Sprintf("%s/api/collections/%s/records", base, url.PathEscape(coll))
		if id != "" {
			u += "/" + url.PathEscape(id)
		}
		return u
	}
	id, _ := args["id"].(string)

	if coll, ok := strings.CutPrefix(name, "list_"); ok {
		if !p.Collections[coll].Read {
			return "", fmt.Errorf("not allowed: read %s", coll)
		}
		limit := 50
		if v, ok := args["limit"].(float64); ok && v > 0 {
			limit = int(v)
		}
		// filter/sort are passed to the collection API, which parses and validates them —
		// a bad expression comes back as the API's own 400, not a silent full listing.
		q := url.Values{}
		q.Set("perPage", strconv.Itoa(limit))
		q.Set("skipTotal", "1")
		if f, ok := args["filter"].(string); ok && f != "" {
			q.Set("filter", f)
		}
		if s, ok := args["sort"].(string); ok && s != "" {
			q.Set("sort", s)
		}
		return apiText("GET", recordURL(coll, "")+"?"+q.Encode(), nil)
	}

	if coll, ok := strings.CutPrefix(name, "get_"); ok {
		if !p.Collections[coll].Read {
			return "", fmt.Errorf("not allowed: read %s", coll)
		}
		return apiText("GET", recordURL(coll, id), nil)
	}

	if coll, ok := strings.CutPrefix(name, "create_"); ok {
		if !p.Collections[coll].Create {
			return "", fmt.Errorf("not allowed: create %s", coll)
		}
		return apiText("POST", recordURL(coll, ""), writablePayload(app, coll, args))
	}

	if coll, ok := strings.CutPrefix(name, "update_"); ok {
		if !p.Collections[coll].Update {
			return "", fmt.Errorf("not allowed: update %s", coll)
		}
		return apiText("PATCH", recordURL(coll, id), writablePayload(app, coll, args))
	}

	if coll, ok := strings.CutPrefix(name, "delete_"); ok {
		if !p.Collections[coll].Delete {
			return "", fmt.Errorf("not allowed: delete %s", coll)
		}
		return apiText("DELETE", recordURL(coll, id), nil)
	}

	return "", fmt.Errorf("unknown tool: %s", name)
}

// writablePayload keeps only the collection's agent-settable fields present in args.
func writablePayload(app core.App, coll string, args map[string]any) map[string]any {
	out := map[string]any{}
	for fname := range writableFields(app, coll) {
		if v, ok := args[fname]; ok {
			out[fname] = v
		}
	}
	return out
}

// apiBase is the engine's own loopback origin. PORT is injected by the supervisor; the
// engine binds 127.0.0.1:$PORT (main), so the MCP handler calls back into that same server.
func apiBase() string {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8090"
	}
	return "http://127.0.0.1:" + port
}

// apiText performs the loopback API call and returns the response body as text, surfacing
// the API's own status + message on failure (so rule/validation errors reach the caller).
func apiText(method, u string, body any) (string, error) {
	var rdr io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, u, rdr)
	if err != nil {
		return "", err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("api %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}
	if method == "DELETE" {
		return "deleted", nil
	}
	return string(data), nil
}

// randomSecret returns a hex-encoded random string of n bytes.
func randomSecret(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		log.Printf("randomSecret: %v", err)
		return ""
	}
	return hex.EncodeToString(b)
}

// ensureSuperuser creates the default admin (_superusers) account if absent, so /_/ is
// reachable on a fresh pb_data. Never overwrites an existing account. When the password
// was generated (no SUPERUSER_PASSWORD set) it is printed once, here.
func ensureSuperuser(app core.App, email, password string, generated bool) {
	if email == "" || password == "" {
		return
	}
	if _, err := app.FindAuthRecordByEmail(core.CollectionNameSuperusers, email); err == nil {
		return // already present
	}
	col, err := app.FindCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		log.Printf("superuser: cannot find %s collection: %v", core.CollectionNameSuperusers, err)
		return
	}
	rec := core.NewRecord(col)
	rec.SetEmail(email)
	rec.SetPassword(password)
	if err := app.Save(rec); err != nil {
		log.Printf("superuser: create %s failed: %v", email, err)
		return
	}
	if generated {
		log.Printf("created superuser %s with a GENERATED password: %s", email, password)
		log.Printf("  ^ save it now, or set SUPERUSER_PASSWORD to choose your own")
	} else {
		log.Printf("created superuser %s — sign in at /_/", email)
	}
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func rpcOK(id, res any) map[string]any {
	return map[string]any{"jsonrpc": "2.0", "id": id, "result": res}
}

func rpcError(id any, code int, msg string) map[string]any {
	return map[string]any{"jsonrpc": "2.0", "id": id, "error": map[string]any{"code": code, "message": msg}}
}
