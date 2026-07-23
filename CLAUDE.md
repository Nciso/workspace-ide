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
4. **Views** — `apps/<name>/views.json`: the operator UI, declared not coded. A `board`
   groups a collection by one of its `select` fields (one column per option); a `table`
   lists `columns`. Every view also takes:
   - `filter` / `sort` — PocketBase expressions, applied server-side (what the view is *about*),
   - `detail` — fields shown in full, with a copy button, when a record is opened,
   - `actions` — declarative one-click writes: `set` (the token `@now` becomes a UTC
     timestamp), `increment`, and `also` to patch the record across a relation in the same
     click (e.g. mark a message sent *and* stamp its contact),
   - `format` — per-view type overrides, e.g. draw a number as currency.

   The engine serves it on `/manifest` and the embedded UI renders it, so **adding a view
   or an action never means rebuilding `ui/dist`**. Omit the file and each collection gets a
   plain table.
5. Schema auto-applies on engine boot (automigrate). Restart the supervisor to discover a
   **new** app folder. No Go rebuild is needed for schema/policy/instructions/views changes.

Invariants (AGENT_SPEC §9): default-deny; destructive ops stay off unless intended; every
field named in policy must exist on the collection; instructions must say what's forbidden.

## Operate an app

```bash
go build -o workspace . && go build -o supervisor ./cmd/supervisor
SUPERUSER_EMAIL=you@co.com SUPERUSER_PASSWORD='strong' ./supervisor
```

- App UI `http://<name>.localhost:8080/` · Admin `/_/` · REST `/api/*`
- MCP **`http://localhost:8080/mcp/<name>`**, bearer in `apps/<name>/agent/.mcp_token`.
  Bare `localhost` is deliberate: Node's `dns.lookup` does not resolve `*.localhost`, so a
  host-routed MCP URL forces a sudo `/etc/hosts` edit on every machine. Claude Code connects
  natively — `claude mcp add --transport http <name> http://localhost:8080/mcp/<name> --header "Authorization: Bearer $(cat apps/<name>/agent/.mcp_token)"`.
  Claude Desktop needs the `mcp-remote` stdio bridge (see README).

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
- **The UI is one shared bundle driven by per-app data** — `ui/dist` is generic; each app's
  `views.json` (served on `/manifest`) tells it what to render, so one embedded bundle
  serves every app. Clicking a row or card opens a detail sheet (full field values, copy
  buttons on `detail` fields) with the view's `actions` as buttons — so marking work done is
  a click, while **creating** records and free-form editing still go through MCP or the admin
  dashboard. Rebuilding `ui/dist` is only needed when changing the *renderers*, never when
  changing an app's views.
- `SUPERUSER_EMAIL` / `SUPERUSER_PASSWORD` are read by each engine (the supervisor forwards
  its own environment to every engine it spawns). The admin is created only if missing; with
  no `SUPERUSER_PASSWORD` set, a random password is generated and printed once at first boot
  (no default credential ships in the source).
