# Workspace IDE

A **local-first IDE for building operational apps that talk to AI**. The repo root *is*
the IDE (a supervisor + router); the apps you build live under `apps/*`, each a fully
isolated PocketBase instance with its own data, schema, MCP tool surface, and agent.

Full design: **[PRD.md](PRD.md)** · agent/MCP contract: **[AGENT_SPEC.md](AGENT_SPEC.md)** ·
working guide for an AI session: **[CLAUDE.md](CLAUDE.md)**.

## Quickstart

```bash
go build -o workspace .                         # the per-app engine
go build -o supervisor ./cmd/supervisor         # the IDE host / router

# admin login defaults to admin@example.com / changeme1234 — override for anything real:
SUPERUSER_EMAIL=you@co.com SUPERUSER_PASSWORD='strong-pass' ./supervisor
```

Open **http://sales.localhost:8080/**. (`*.localhost` resolves to loopback in every modern
browser; `:8080` is the router port.)

| URL | What |
|---|---|
| `http://sales.localhost:8080/` | app UI |
| `http://sales.localhost:8080/_/` | admin dashboard (sign in with the superuser above) |
| `http://sales.localhost:8080/api/*` | PocketBase REST |
| `http://sales.localhost:8080/mcp` | per-app MCP server (bearer-authed) |

## The two workflows

### 1. Define an app — data + agent

An app is a folder under `apps/<name>/`:

```
apps/<name>/
  pb_migrations/<ts>_init.js   # schema — collections & fields (source of truth)
  agent/policy.json            # which collections the MCP tools may read/create/update/delete
  agent/instructions.md        # the agent persona + guardrails
  pb_data/                     # this instance's SQLite (gitignored, auto-created)
```

Edit `pb_migrations` to shape the data model (auto-applied on boot); scope the AI's powers
in `policy.json` (**default-deny**). Restart the supervisor and the new app is discovered,
routed at `<name>.localhost`, with `/api`, `/_/`, and `/mcp` all live. Step-by-step in
**[CLAUDE.md](CLAUDE.md)**.

### 2. Operate an app — use it

- **Directly**: the admin dashboard (`/_/`) and the REST API.
- **With AI (the primary interface)**: connect the per-app **MCP server** to any MCP client
  (Claude Desktop, ChatGPT, …). Endpoint `http://<name>.localhost:8080/mcp`; bearer token in
  `apps/<name>/agent/.mcp_token`. Tools are generated from the schema, gated by
  `policy.json`, and executed through the app's own API (so its rules + validation apply).

```bash
TOKEN=$(cat apps/sales/agent/.mcp_token)
curl -s -H "Host: sales.localhost" -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' http://127.0.0.1:8080/mcp \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

A single engine can also run standalone, without the router:
`WORKSPACE_DIR=apps/sales PORT=8090 ./workspace`.

## Repo map

```
main.go                 # the ENGINE — serves one app folder (target: cmd/engine, pending)
cmd/supervisor/main.go  # the SUPERVISOR — stdlib host-router: discovers apps/*, lazy-spawns
                        #   engines, routes <app>.localhost, gates /mcp with a bearer token
apps/<name>/            # the apps you build (sales = reference app)
ui/                     # the engine's embedded SPA (Vite/React). ui/dist is COMMITTED —
                        #   the engine embeds it via go:embed, so a clone builds as-is.
PRD.md · AGENT_SPEC.md  # design + agent/MCP contract
CLAUDE.md               # how an AI session should work in this repo
```

## Status

**Works now (local, single machine):** supervisor + stdlib router, lazy-spawn, per-app
engine, PocketBase data + admin + REST, MCP-as-API-facade (list/get/create/update/delete,
policy-gated), default admin account.

**Opt-in / not wired yet:**

- **Sync & sharing** (build → use → share → sync). Proven on libSQL embedded replicas
  ([PRD §6.4](PRD.md)); enabled per app by swapping the engine's DB to a libSQL replica via
  PocketBase's `Config.DBConnect` hook. Today the engine runs **plain SQLite = local only**.
- **Per-app tailored UI + Bun/Vite authoring** — apps currently share the embedded UI; the
  bespoke `web/`→`dist/` flow (PRD §10 step 5) is pending. Operate new apps via MCP + admin.
- **EVE** in-browser WebLLM chat — experimental, not built.

## Build & verify

```bash
go build ./... && go vet ./...
```
