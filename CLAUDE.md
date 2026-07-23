# Working in this repo (Claude Code session guide)

This repo is the **Workspace IDE** — a local-first host for operational apps that talk to
AI. Your two jobs here are **define an app** and **operate an app**. Read **[PRD.md](PRD.md)**
for the why and **[AGENT_SPEC.md](AGENT_SPEC.md)** for the agent/MCP contract; this file is
the operational cheat-sheet.

## Mental model

- The repo root is the IDE. `main.go` is the **engine** (serves one app folder).
  `cmd/supervisor` is the **supervisor** — a stdlib Go host-router that discovers `apps/*`,
  lazy-spawns one engine per app, and routes `<app>.localhost`.
- Each app under `apps/<name>/` is an **isolated PocketBase instance**: its own SQLite
  (`pb_data/`, gitignored), schema (`pb_migrations/`), and agent (`agent/`).
- The MCP server is a **facade over the app's own REST API** — MCP tool calls execute
  through `/api` (so PocketBase rules + validation + hooks apply), gated by `agent/policy.json`.
  `/mcp` is the only auth'd path (per-app bearer); `/` and `/api` are open to the local operator.

## Define an app

Fastest path — copy the template (folders under `apps/` starting with `_` or `.` are
skipped by the supervisor, so the template never runs as an app):

```bash
cp -R apps/_template apps/<name>
mv apps/<name>/pb_migrations/1700000000_init.js "apps/<name>/pb_migrations/$(date +%s)_init.js"
```

Then edit the three files:

1. **Schema** — `apps/<name>/pb_migrations/<unix_ts>_init.js`: collections + fields. Keep
   rules open (`listRule/viewRule/createRule/updateRule/deleteRule: ""`) for the single
   local operator. Model it on `apps/sales/pb_migrations/1700000000_init_sales.js`.
2. **Policy** — `apps/<name>/agent/policy.json`, **default-deny**. Enable only what the AI may do:
   ```json
   { "defaults": { "read": false, "create": false, "update": false, "delete": false },
     "collections": { "<coll>": { "read": true, "create": true } } }
   ```
   Tools are generated per allowed op: `list_/get_` (read), `create_`, `update_`, `delete_`.
3. **Instructions** — `apps/<name>/agent/instructions.md`: persona + guardrails; state what
   the agent may **not** do.
4. Schema auto-applies on engine boot (automigrate). Restart the supervisor to discover a
   **new** app folder. No Go rebuild is needed for schema/policy/instructions changes.

Invariants (AGENT_SPEC §9): default-deny; destructive ops stay off unless intended; every
field named in policy must exist on the collection; instructions must say what's forbidden.

## Operate an app

```bash
go build -o workspace . && go build -o supervisor ./cmd/supervisor
SUPERUSER_EMAIL=you@co.com SUPERUSER_PASSWORD='strong' ./supervisor
```

- App UI `http://<name>.localhost:8080/` · Admin `/_/` · REST `/api/*`
- MCP `http://<name>.localhost:8080/mcp`, bearer in `apps/<name>/agent/.mcp_token` — paste
  URL + token into an MCP client. Smoke-test with the `tools/list` / `tools/call` curl in
  the README.

## Verify any change

```bash
go build ./... && go vet ./...
```

## Key facts / gotchas

- **Router = stdlib net/http**, not Caddy (Caddy was removed; `go.mod` has zero caddy deps).
- **`ui/dist` is committed** — the engine embeds it via `//go:embed all:ui/dist`, so a fresh
  clone must have it to build. Rebuild the UI with `cd ui && bun run build` (or npm).
- The engine currently lives at repo root `main.go`; the target location is `cmd/engine/`
  (pending — moving it must relocate the embedded `ui/dist` too, PRD §10).
- **Sync is NOT wired** — the engine runs plain SQLite. To turn it on, swap the DB to a
  libSQL embedded replica via PocketBase's `Config.DBConnect` (proven in a spike, PRD §6.4);
  needs a `sqld` primary + the CGO `go-libsql` driver.
- **Per-app tailored UI isn't built yet** — new apps share the embedded UI; operate them via
  MCP + the admin dashboard until the `web/`→`dist/` authoring flow lands.
- `SUPERUSER_EMAIL` / `SUPERUSER_PASSWORD` are read by each engine (the supervisor forwards
  its own environment to every engine it spawns). The default admin is created only if missing.
