# Workspace IDE — PRD

**Status:** Draft · **Date:** 2026-07-23 · **Owner:** Enrique Enciso

---

## 1. Summary

This repo is an **IDE for building operational apps that talk to AI** — a local-first
*Bubble/Retool for AI harnesses*. The root folder **is the IDE**: a thin supervisor +
local router. The apps you build live in an **`apps/` subfolder**, one per subfolder.
**Each app is a fully isolated PocketBase instance** — its own process, SQLite data,
and domain — spawned by the supervisor and routed by a **stdlib Go host-router** (a
single Go binary — no Node, no embedded web server).

Each app's UI is a **code-driven SPA** — real TSX (React + TanStack Query/Router/Table
+ shadcn/ui + Tailwind), authored by **Claude Code** and compiled with the **standard
Vite toolchain at authoring time** to **static assets** the Go engine serves. The
shipped product contains **no build tool**; operators install nothing.

### 1.1 Who it's for, and what it is not

- **The builder is a non-technical person who can open and converse with a harness**
  (Claude Code), but writes **no code**. They don't use a terminal to run build
  commands, read TSX, or manage a toolchain — they describe what they want, and the
  **harness does all the coding and building**, guided by skills. The harness *is* the
  authoring UI; the IDE's job is to make that harness's edits safe and its builds
  automatic (§7).
- **The apps are operational tooling for SMBs**, not full-production platforms. They
  manage a small business's operational data. **They do not carry full-production
  responsibility** — no high scale, multi-region, or compliance-grade concerns.
  "Production-ready" here means *reliable enough to run SMB operations*, which is
  exactly why SQLite + one binary + localhost is the *right-sized* amount of
  engineering, not a shortcut.

An app is **local-first, not local-only.** Its data lives in the app's own SQLite and
works fully offline; **sync is an opt-in layer** (per app) that lets one operator's app
travel across their devices and lets a builder **share an app together with its data**
for someone else to run locally. When sync is on, data does leave the machine — the
honest trade for sharing — but local stays the source of truth and nothing depends on a
network at rest. This is still *right-sized*: sync is last-write-wins for a handful of
operators, **not** multi-region HA (§6.4, §9).

Design principle: **don't reinvent the wheel, use the toolchain the ecosystem (and the
agent) already knows, and never make an operator install anything.**

Two roles:

- **Builders** author apps by **conversing with a harness** (Claude Code). The harness
  writes the TSX + PocketBase migrations and runs the build with the IDE-bundled
  toolchain — the builder writes no code and configures nothing.
- **Operators** open an app at its local domain and use its surfaces. AI is optional on
  top: a frontier model operates the app through its **per-app MCP server**, while an
  in-browser **EVE** chat is an experimental local option (§6).

---

## 2. Problem — where we are today

`main.go` is a PocketBase runtime with the "Sales" product compiled into it. The data
model is folder-driven, but the *product* is baked in: `ui/src/lib/workspace.ts` is a
TypeScript constant holding collections + view specs, imported by `App.tsx` at build
time.

| Concern      | Where it lives today                          | Folder-driven? |
| ------------ | --------------------------------------------- | -------------- |
| Data         | `sales/pb_data/` (SQLite)                     | ✅ yes         |
| Schema       | `sales/pb_migrations/*.js`                    | ✅ yes         |
| **UI**       | `ui/src/*` compiled against `workspace.ts`    | ❌ **baked in** |

So the binary is *a sales app*, not *an IDE*: the product is compiled in, and there's
no notion of many apps, isolation, routing, or an agent. The binary is already a fine
*single-app engine* — we need to run many of them, each carrying its own UI code.

**Goal:** a supervisor that runs one isolated, code-driven app-instance per `apps/*`
folder, built with the mainstream toolchain, serving zero-install static output, each
with an operational agent.

---

## 3. Target architecture

### 3.1 Layout — root is the IDE, `apps/` is what you build

```
workspace_idea_prd/          # ← the IDE (this repo)
  cmd/supervisor/            #   scans apps/, spawns one engine per app, routes them
  cmd/engine/  (= today's main.go)   #   per-app binary: serves one app folder
  apps/                      #   everything built with the IDE
    sales/                   #   one app = one ISOLATED PocketBase instance
      pb_migrations/         #     schema (source of truth, diffable JS)
      pb_data/               #     this instance's SQLite (gitignored)
      web/                   #     the app's UI source (real TSX, Vite project)
        src/routes/*.tsx     #       code-driven surfaces (TanStack Router)
        src/components/*.tsx #       app + shadcn components
        package.json         #       standard Vite/React deps
      dist/                  #     built static assets (committed) — what the engine serves
      skills/                #     how a harness safely edits THIS app
      agent/                 #     EVE, eve.dev-style: instructions.md · tools/policy · model
    support/  ...
```

Isolation is total: separate processes, databases, and domains. Nothing
product-specific lives in the root.

### 3.2 The supervisor + router

The root does **not** host PocketBase. It:

1. **Discovers** apps by scanning `apps/*`.
2. **Spawns** one engine process per app — the existing binary with
   `WORKSPACE_DIR=apps/<name>`, honoring the `PORT` injected by the router.
3. **Routes** each to a stable local domain with a **~150-line stdlib Go host-router**
   (`net/http` + `httputil.ReverseProxy`): `sales.localhost → 127.0.0.1:PORT`, **lazily
   spawning** the engine on first request. No embedded web server — one config model
   (Go) and a small binary. `*.localhost` is a browser secure-context even over plain
   HTTP (so WebGPU/WebLLM work), so v1 needs **no TLS at all**. The router treats
   **`/mcp` as a first-class network surface** — per-app bearer auth + streaming
   passthrough (`FlushInterval:-1`, no write deadline) — while `/` and `/api` stay open
   for the local operator (§6.1). **Reach is a bind choice, not a rearchitecture:**
   loopback by default (local MCP clients), `0.0.0.0` for LAN, or a tunnel in front for
   web clients — the bearer token makes non-loopback safe. **Embedded Caddy is deferred**
   to when real edge TLS earns it (v2 remote reach / production cookies), added as a
   `:443` terminator *in front of* this router without changing it.
4. Optionally serves a **launcher** at `ide.localhost` — list of apps + a "new app"
   entry point.

### 3.3 The per-app engine — serve only, no build

Each engine, pointed at `apps/<name>/`, is a pure runtime — **no bundler in the
product**:

1. **Serves** the committed `dist/` (SPA) + `/api/*` (PocketBase REST) + admin `/_/`,
   all same-origin.
2. **Auto-migrates** on boot (already the behavior via `migratecmd.Automigrate`).

The app's TSX talks to its own `/api` (as `pb.ts` does today). TanStack Query handles
fetching/caching; TanStack Router handles routing; TanStack Table powers grids; shadcn
+ Tailwind provide the design system — all standard, all documented.

### 3.4 The two modes

```
        apps/<name>/  ── pb_migrations · pb_data · web(TSX)→dist · skills · agent
              ▲ edits + `vite build` (terminal)     ▲ runs isolated at <name>.localhost
              │                                      │
   ┌──────────┴───────────┐            ┌─────────────┴──────────────┐
   │ BUILD  · Claude Code  │            │ OPERATE · one engine/app    │
   │ writes TSX + migrations│           │ serves committed dist +     │
   │ builds with Vite       │           │ /api; EVE reads + acts      │
   └───────────────────────┘            └─────────────────────────────┘
```

An in-app "build with AI" panel is out of scope for v1 (§9).

---

## 4. What an app is

An app under `apps/<name>/` is a **PocketBase project + a standard Vite/React
front-end** — nothing bespoke:

| Part            | It's just…                                  | Editable by |
| --------------- | ------------------------------------------- | ----------- |
| `pb_migrations/`| PocketBase migrations (JS)                  | Claude Code, or PB admin `/_/` |
| `pb_data/`      | this instance's PocketBase SQLite           | the engine (runtime) |
| `web/`          | a Vite React app (TSX + shadcn + TanStack)  | Claude Code |
| `dist/`         | built static output (committed)             | `vite build` |
| `skills/*`      | Markdown: invariants + how to edit this app | Claude Code |
| `agent/*`       | eve.dev-style agent: `instructions.md` + tool/policy + model; also served as an MCP server | Claude Code |

Surfaces are **real code the agent composes** from the design system, dropping to raw
TSX where a surface needs something bespoke. The "compatible with agent skills" bet:
harnesses write idiomatic React with the standard stack well, and skills + shadcn
supply guardrails and consistency for a junior builder.

---

## 5. Build mode — conversing with the harness

The builder never edits files directly. They open the harness (Claude Code) and
describe the change; the harness edits `apps/<name>/`, guided by that app's `skills/`:

1. Builder (in plain language): *"In the sales app, let me track a phone number for each
   contact and show it in the contacts list."*
2. The harness writes a migration in `pb_migrations/` and updates the route in
   `web/src/routes/contacts.tsx` (shadcn/TanStack, bound to `/api`).
3. The harness runs the build with the **IDE-bundled toolchain** (§7), refreshing
   `dist/`. The engine auto-migrates on boot and serves the new surface — no Go
   recompile, no other app touched, and the builder ran no commands.

New app = the harness scaffolds `apps/<newname>/` from a template (`web/` Vite project +
initial migration) following an IDE-level skill; the supervisor discovers it and gives
it a domain.

---

## 6. Operate mode — the app first, AI on top

**The product's core value is the operational app itself** — the PocketBase data model +
real UI the operator uses daily (follow-ups, deals, tickets…). The app must be fully
useful with **zero AI**. AI is layered on in order of leverage:

1. **The per-app MCP server — the primary AI interface.** Each app exposes **its own**
   standards-compliant MCP endpoint; the operator brings their **own operational
   harness** (Hermes, Claude Cowork, Claude Desktop, ChatGPT, … — any MCP client) and
   operates the app through it — query, fill, review — with no API keys in the app. The
   app is a *harness-agnostic compatible surface*, not tied to one client. Full contract
   in **`AGENT_SPEC.md`**.
2. **EVE — an experimental seed.** An in-browser local-model chat over the *same* tools;
   private/offline and nice to have, but **not load-bearing** (small-model tool-calling
   is unreliable for multi-step actions, §6.2). Build value on the app + MCP, not on EVE.

EVE and MCP share one tool surface (§6.1). EVE's `agent/` folder uses the **eve.dev
convention** (`instructions.md` + tool/policy + model).

### 6.1 One data plane, several protocol facades

Each app's PocketBase engine turns its schema into a **per-app collection API**
automatically. The other surfaces are **facades over that same API**, not separate paths
into the data:

- **REST `/api`** → the UI (TanStack Query).
- **`fetch('/api/...')`** → EVE's in-browser function-calling tools.
- **`/mcp`** → external harnesses, a protocol **adapter over the same collection API**
  (one endpoint per app, at `<app>.localhost/mcp`).

Because MCP writes traverse the **same enforcement path** a UI write does — a call to the
app's **own loopback REST API**, **not** a raw ORM call — they inherit the app's rules,
validation, and request hooks identically. (Schema introspection stays in-process,
read-only; only the data operation crosses `/api`.) The agent **`policy.json` composes on
top of** the app's PocketBase rules: PB rules are the baseline authz (open in v1, §9);
`policy.json` is the tighter, agent-specific allow-list (default-deny, field-level,
confirm-gates — AGENT_SPEC §4). Same schema, multiple facades, one enforced data plane;
this is "an editable workspace for harnesses" made literal.

### 6.2 Switchable model providers (operator-selectable)

1. **Local open-weight — experimental, private.** [WebLLM](https://github.com/mlc-ai/web-llm)
   (WebGPU, OpenAI-compatible, native function-calling) runs a **client-side agent
   loop**: the model generates *in the browser* and calls tools that are
   `fetch('/api/...')` against PocketBase. Zero-cost, offline, data never leaves the
   machine. No server-side agent process — the Go engine stays a data server. Model is
   tiered by hardware:
   - integrated GPU → **Qwen ~1.5B** (~1 GB weights)
   - **default → Qwen ~3–4B Instruct** (best small-model tool-calling; ~2 GB)
   - discrete/M-series GPU → **Qwen ~7–8B** (near-frontier tool-calling)
2. **MCP to Claude / ChatGPT — the primary way to operate with a capable model.** The
   app runs as a per-app **MCP server**; the operator connects their existing Claude or
   ChatGPT and operates the app with a frontier model. No API key managed by the app.
   The MCP is on **loopback**, so it pairs naturally with a **local-MCP client (Claude
   Desktop)** — data stays on the machine. Remote/web clients need remote reach (§6.3,
   v2). Note: **MCP carries tools/resources, not completions** — the model lives in the
   operator's client; the app is the tool surface.
3. **Deferred — direct completions API** (OpenRouter / bring-your-own key). See §8.

Because providers 1 and 2 share the same declared tool policy, switching is a config
choice in `agent/`, not a rewrite.

> **Reliability caveat.** A 3–4B in-browser model is strong at *reading/answering* but
> the weakest link at *multi-step actions* (chained mutations). The local→MCP switch is
> the escape hatch: keep local for privacy and cheap reads, flip to a frontier model
> via MCP for complex operations. Same tools either way.

### 6.3 Lifecycle & getting data in

The loop is **author → ship → operate**:

1. **Author** — open the workspace in a harness (Claude Code); define the app in
   `apps/<name>/`.
2. **Ship** — the harness builds it; the supervisor serves it at `<name>.localhost`.
   "Ship" means *going live locally* — no packaging/hosting in v1 (§9).
3. **Operate** — the operator (often the same person) uses the app daily.

**Filling the app with external data (e.g. Supabase → follow-ups):**

- **v1 — the harness is the integrator.** The operator's Claude has *both* MCP servers
  connected: the **app's MCP** (write follow-ups) and an **external MCP** (read source
  rows). Claude bridges them in one conversation — "pull these rows, create follow-ups"
  — with **zero integration code in the app**. Interactive/on-demand, not scheduled.
- **[Smithery](https://smithery.ai) for the connector side.** Rather than hand-wiring
  each third-party MCP, use Smithery as the **registry + OAuth/gateway** to discover and
  connect external MCPs (Supabase, Gmail, …). Low tension — these are external services,
  not the app's local data.
- **v2 — direct connectors.** The app connects to the source itself (MCP client or
  Postgres) for automated, scheduled sync with field mapping. Deferred (§8).
- **Remote reach for the app's MCP — mechanism is v0.** The router exposes `/mcp` with
  per-app bearer auth + streaming from day one; *reach* is a bind choice (§3.2): loopback
  (local clients like Claude Desktop) by default, `0.0.0.0` for LAN, or a tunnel
  (Tailscale/ngrok) / **Smithery gateway** to let **web** clients (ChatGPT web, Claude
  web) in — noting a hosted gateway routes operational data through a third party (a
  privacy trade-off; loopback + Claude Desktop avoids it).

This is the "editable workspace for harnesses" thesis end-to-end: the harness *builds*
the app **and** *wires it to other systems*, while the app stays the durable value.

### 6.4 Syncable local-first — the build → use → share → sync loop

Sync is a **first-class, opt-in** capability (not the deferred maybe it once was). It
turns the lifecycle into four verbs — **build → use → share → sync** — where only *share*
is new: a builder shares an app **together with its data**, and someone else runs it
locally with changes reconciling both ways.

**Engine decision — no fork, no rewrite.** An app's data can run on a **libSQL embedded
replica** instead of a plain SQLite file, via PocketBase's supported **`DBConnect`** hook
(~15 lines; stock PocketBase, source untouched). Local reads/writes stay full-speed and
offline; writes forward to a **primary** (a hidden `sqld` — self-hosted to start) and a
sync pull brings other instances' changes in. A spike proved PocketBase **bootstraps and
auto-migrates onto a libSQL replica**, and that schema + data propagate across replicas;
independent prior art (PB discussion #5969; the `libsqldb` module) confirms the pattern.

**Sharing semantics — additive + last-write-wins.** Concurrent distinct inserts from two
instances both survive; a same-row conflict resolves **last-write-wins** with no
corruption (measured). Right-sized for a handful of SMB operators — **not**
live-collaborative co-editing.

**A deliberate, *loud* ceiling.** PocketBase is single-instance at the application layer:
hooks + realtime (and therefore the goja custom agent tools, AGENT_SPEC §5) fire **only on
the instance that received the write**, never on replicas (confirmed by PB's maintainer).
So a second instance sees another's data on query/sync/refresh but **not reactively**, and
side-effecting hooks don't run for replicated writes. This limit is *accepted*: hitting it
means the user's app has **graduated** past an SMB tool. The rule: keep the ceiling
**loud, not silent** — visible limits (UI not live-updating → refresh; slow WAN bulk
writes) are fine graduation signals; the one *silent* risk (a side-effecting hook that
simply never fires for a replicated write) must be **surfaced by the authoring skill** when
sync + side-effecting hooks coexist, with a documented exit ramp. *A deliberate ceiling is
a feature; a silent one is a bug.*

**Write-latency caveat.** Every write is a round-trip to the primary (≈ `1000 / RTT_ms`
writes/sec; ~4 ms local, tens of ms over WAN). Interactive operation never feels it, but
**bulk imports must batch in a transaction** (one sync unit) to avoid the reported
`600-rows > 30s` pathology (PB #6296). Reads are local and instant.

**Limits (SMB-sized).** Keep an app's DB **under ~1–2 GB** for snappy sync; single field
values **under ~1 MB** (big blobs → PocketBase file storage). **Attachments don't ride the
DB sync** — file storage is separate; treat shared-app files as local-only unless pushed to
S3-compatible storage both sides can reach.

---

## 7. Footprint & toolchain — build at authoring, ship static

The hard requirement: **operators install nothing.** Met by keeping the build entirely
at authoring time and shipping only static output.

**Runtime (operators): a single self-contained Go binary.**
- The engine serves the app's committed `dist/` (+ `go:embed` for the shell). No Node,
  no `node_modules`, no bundler, no network at runtime. Just the binary + SQLite.

**Build (the harness, not the human): bundled toolchain, standard Vite, no setup.**
- The builder is a non-coder who won't install or configure anything, so the **IDE
  bundles the build toolchain** — **Bun**, a single native binary — and ships **skills**
  that tell the harness how to build. When the harness edits an app, it runs the real
  **Vite** build through the bundled Bun; the human runs no commands and installs
  nothing.
- Because we use the real toolchain, **Tailwind + shadcn work exactly as documented** —
  no special CSS handling, no component-first constraint.
- Bun (single embedded binary, no Node, no `node_modules` install ceremony) is what
  makes "the harness can build on the user's machine with zero setup" true.

**Rejected: a bundler inside the product** (esbuild-in-Go, embedded Node/V8). esbuild-Go
is real esbuild, but a *bespoke* pipeline diverges from the Vite path the whole
ecosystem and the agent assume — the fragility is the divergence, not the tool. Moving
the build out of the product removes it entirely.

---

## 8. Deferred decisions

| Decision            | Options | Why deferred |
| ------------------- | ------- | ------------ |
| **Cloud completions** | OpenRouter · **vs** · bring-your-own API key — **deferred** | Local (WebLLM) + MCP-to-Claude/ChatGPT cover v1; add direct-API for users without an MCP client. |
| **External data sync** | v1: the operator's harness bridges MCPs (Smithery for the connector registry) · **vs** · v2: direct connectors (Supabase MCP client / Postgres, scheduled) | v1 needs no integration code; automated sync is a v2 feature. |
| **App-MCP remote reach**| **Mechanism decided (v0):** router serves `/mcp` with bearer + streaming; reach is a bind choice — loopback → LAN → tunnel/Smithery | Only *web-client* reach (a tunnel) is deferred; the local mechanism ships now (§3.2, §6.3). |
| **Local model default** | Fixed (Qwen ~3–4B) · **vs** · auto-select by detected WebGPU capability | Ship fixed; add hardware detection later. |
| **MCP connector setup** | Operator pastes the app's MCP URL into Claude/ChatGPT · **vs** · a guided in-app flow | UX detail; the protocol is stable. |
| **`dist/` handling**| Committed to the repo · **vs** · the harness rebuilds and the engine serves the fresh output | Committed is simplest; either way the human never runs a build. |

**Decided (moved out of deferred):** the **engine** stays stock PocketBase with libSQL via
`DBConnect` (no fork); **instance-level sync** (build → use → share → sync) is in scope and
opt-in (§6.4); the **router** is a stdlib Go host-router, not embedded Caddy (§3.2).

---

## 9. Non-goals (v1)

- **Full-production responsibility** — scale, multi-region, HA, compliance-grade auth.
  These are operational SMB tools (§1.1). Opt-in last-write-wins sync (§6.4) is *not*
  multi-region HA — it's a shared primary for a handful of operators, with a deliberate
  ceiling.
- **A separate in-app "build with AI" chat** — unnecessary, because the harness the
  builder opens (Claude Code) *is* the conversational authoring surface. We don't
  rebuild it inside the app.
- **Multi-tenant / hosted** — local supervisor, local `apps/` folder, `*.localhost`.
- **Auth hardening** — rules stay open (`""`) for the single local operator.
- **Cross-app data sharing** — apps are isolated by design. (Cross-*instance* sync of the
  *same* app **is** in scope and opt-in — §6.4: one app's data on many machines, not two
  apps sharing data.)

---

## 10. Migration path (as-is → to-be)

Ordered so the app keeps running at every step:

1. **Relocate the app.** Move `sales/` → `apps/sales/`; make the engine resolve
   `WORKSPACE_DIR` and honor injected `PORT` (bind `127.0.0.1:$PORT`).
2. **Split binaries.** Keep today's `main.go` as the **engine**; add a **supervisor**
   that scans `apps/*` and spawns one engine per app.
3. **Add the router.** Front the engines with the **stdlib Go host-router** (§3.2):
   `<name>.localhost → 127.0.0.1:PORT`, lazy-spawn on first hit, `/mcp` behind a per-app
   bearer with streaming. (Embedded Caddy only returns if v2 edge TLS needs it.)
4. **Make the engine serve committed `dist/`.** Point static serving at the app's
   `dist/`; keep `go:embed` only for the IDE shell.
5. **Turn the sales UI into a real Vite app.** Move `ui/src/*` into `apps/sales/web/`,
   replace the `workspace.ts` import with real components fetching `/api` via TanStack
   Query. `vite build` → commit `dist/`. Delete the compiled `workspace.ts` mock.
6. **Add per-app `skills/` + `agent/`.** Seed them for `apps/sales/` as the reference.
7. **Define `POST /api/agent`** (interface + stub) so the UI can build the EVE chat
   surface against a contract while the runtime is chosen (§8).
8. **Author the app-scaffold template + skills** so a junior dev can create a new app
   and add surfaces on rails.

After step 5 the root is an IDE running isolated, code-driven app instances that ship
zero-install static output; 6–8 add the agent, authoring rails, and reference content.

---

## 11. Open questions

- Does `apps/sales/` stay as the canonical **example app**, or ship the IDE empty?
- Does the supervisor **spawn apps eagerly** on launch or **lazily** on first request?
- How strong are the **rails/skills** so a harness driven by a non-coder can't produce a
  broken or unsafe app — how much do skills + a component kit constrain the harness?
- Is the **Bun toolchain embedded in the IDE binary** or fetched on first run (size vs
  offline setup)?
- **MCP surface: per-app (decided).** Each app exposes its own MCP at `<app>.localhost`.
  Open sub-question: is connecting each app separately in Claude Desktop acceptable, or
  do we later want an aggregating gateway (Smithery) for a single connection?
- Should the **in-browser model weights** be fetched from a CDN on first run or
  optionally vendored/cached by the engine for fully-offline installs?
- Minimum viable `agent/tools.json` policy: allow/deny per collection + operation, or
  richer (field-level, row filters)?
- Skills: **per-app**, **IDE-global**, or both?
- App creation: a `workspace new <name>` scaffold command, or a Claude Code task
  following an IDE-level skill (or both — command scaffolds, skill guides)?
