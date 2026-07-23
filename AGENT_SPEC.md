# Agent Spec — the `agent/` folder

**Status:** Draft · **Date:** 2026-07-23 · Companion to `PRD.md` §6

This specifies the per-app agent: the `agent/` folder that defines EVE (the experimental
in-browser assistant) **and** the app's MCP server (the primary AI interface). Both
consume one authored policy. Transport is the router's job (§7), so the engine implements
only agent *logic*.

The MCP server is a **harness-agnostic operational surface**: the operator brings their
own operational harness — Hermes, Claude Cowork, Claude Desktop, ChatGPT, or any
MCP-capable client — and drives the app through it. The design goal is *compatibility
with harnesses*, not a bespoke agent; standards-compliant MCP is the contract.

---

## 1. Principles

- **Authored like the app.** `agent/` is written by the harness (Claude Code) from
  plain-language intent, guided by `skills/`, and versioned/diffable like the rest of
  `apps/<name>/`. The non-coder never edits it by hand.
- **One policy, two consumers.** A single `policy.json` (+ collection schemas) drives
  both the in-browser function-calling tools and the MCP server. No duplicated tool
  definitions.
- **Harness-agnostic.** The MCP surface targets the **standard** (Streamable HTTP
  transport; `tools`, `resources`, `prompts`, server `instructions`) so *any* operational
  harness works — no per-harness code. The app is a compatible surface, not tied to one
  client.
- **Tools are generated from the schema.** For each allowed collection, the engine emits
  canonical CRUD tools whose argument schemas come from PocketBase's own field
  definitions — so tools never drift from the data model. Custom tools are an opt-in
  extension (§5).
- **Default-deny.** Nothing is exposed unless the policy opts it in. Safe for
  harness-authored, non-coder-owned apps.
- **Server-side enforcement.** The policy is enforced in the engine, never trusted to
  the (browser) caller. The advertised tools and the enforced tools are the same set.
- **The router owns transport.** Routing, streaming, and edge auth live in the stdlib Go
  host-router; the engine speaks plain local HTTP. TLS is deferred (v2), added in front of
  the router. (§7)
- **MCP is a facade over the collection API.** The `/mcp` adapter calls the app's own
  **loopback REST API** — the *same* enforcement path a UI write hits — so MCP writes
  inherit the app's rules, validation, and request hooks; `policy.json` composes *on top
  of* those baseline rules (PRD §6.1). Schema introspection stays in-process (read-only);
  only the data operation crosses `/api`.

---

## 2. Folder layout

```
apps/<name>/agent/
  instructions.md     # persona + guardrails — the system prompt AND the MCP server "instructions"
  policy.json         # tool policy: collections × operations, field rules, filters, gates
  agent.json          # config: providers/model, EVE on/off, MCP settings
  tools/              # optional custom/high-level tools beyond generated CRUD (§5)
    <tool>.json       #   declaration (name, description, input schema, impl ref)
    <tool>.js         #   optional implementation, run via the engine's JS runtime (pb_hooks/goja)
```

Only `instructions.md`, `policy.json`, and `agent.json` are required. `tools/` is empty
until a surface needs logic beyond CRUD.

---

## 3. `instructions.md`

Natural-language persona + operating rules. Consumed **twice**:

- as the **system prompt** for the in-browser EVE loop, and
- as the MCP server's **`instructions`** field (and offered as an MCP prompt), so a
  connected Claude/ChatGPT inherits the same persona and guardrails.

Authored, so it reads like intent, e.g.:

```markdown
You are the operations assistant for the Follow-ups app. Help the operator triage and
update follow-ups. You may create follow-ups and mark them done or snoozed. Never delete
records. When unsure which contact a follow-up is for, ask. Summarize before acting on
more than 5 records.
```

---

## 4. `policy.json` — the heart

Declares, per collection, which operations are allowed and under what constraints. The
engine reads this **plus** the collection's field schema to generate concrete tools.

```json
{
  "defaults": { "read": false, "create": false, "update": false, "delete": false },
  "collections": {
    "followups": {
      "read":   true,
      "create": true,
      "update": { "fields": ["status", "notes", "due_date"] },
      "delete": false,
      "filter": "owner = @operator",
      "confirm": ["create", "update"]
    },
    "companies": { "read": true }
  }
}
```

Semantics:

| Key        | Meaning |
| ---------- | ------- |
| `defaults` | Baseline for unlisted collections/ops. Ship **all-false** (default-deny). |
| `read` / `create` / `update` / `delete` | `true` allows the op; an object narrows it. |
| `update.fields` / `create.fields` | Field-level allow-list; omitted fields are not writable by the agent. |
| `read.fields` | Optional field mask on returned records (hide sensitive columns). |
| `filter` | A PocketBase filter expression scoping which rows the agent sees/touches. `@operator` and similar are engine-provided context vars. Optional in single-operator v1. |
| `confirm` | Operations that require a human-in-the-loop gate (§6). |

### 4.1 Generated tools

For each allowed collection the engine emits, with args derived from the field schema:

- `list_<collection>(filter?, sort?, page?, perPage?)`
- `get_<collection>(id)`
- `create_<collection>(<writable fields>)`
- `update_<collection>(id, <writable fields>)`
- `delete_<collection>(id)`  *(only if allowed; typically gated)*

Field types map to JSON Schema (text→string, number→number, select→enum, date→string
date, relation→id ref). This mapping is the same one the UI renderer uses, kept in one
place.

### 4.2 Enforcement

Every generated tool executes through a single engine code path that re-checks the
policy: operation allowed? fields within the allow-list? row within `filter`? gate
satisfied? A tool that isn't in the policy simply doesn't exist. The browser loop and the
MCP server hit the **same** enforced path — the browser is never trusted to self-limit.

---

## 5. Custom tools (extension)

When a surface needs more than CRUD (e.g. `close_followup` = set status + stamp
`closed_at` + append a note), the harness authors a custom tool:

```json
// agent/tools/close_followup.json
{
  "name": "close_followup",
  "description": "Mark a follow-up done and stamp the close time.",
  "input": { "id": "string", "resolution": "string" },
  "impl": "close_followup.js",
  "confirm": true
}
```

Implementation runs in the engine's existing JS runtime (PocketBase `pb_hooks` / goja —
no new runtime), so a custom tool is just a small authored function with full ORM access,
reusing the same mechanism the app already uses for hooks. Custom tools appear to both
consumers identically. *(v1 may ship generated-CRUD only; this is the seam for growth.)*

---

## 6. Human-in-the-loop gates

Gated operations (`confirm`) use a transport-agnostic **two-phase** pattern:

1. First call returns `{ status: "needs_confirmation", preview, confirmToken }` — no
   mutation yet.
2. A second call with `confirmToken` executes.

- **EVE (browser):** the chat UI renders `preview` and a confirm button; approval
  re-issues the call with the token.
- **MCP (any operational harness):** the harness surfaces the preview to the operator and
  calls again with the token on approval (matching eve.dev-style approval gates).

Same gate, both surfaces — because it's enforced in the shared engine path, not the UI.

---

## 7. Transport — the router does the heavy lifting

The engine exposes plain local HTTP; the **stdlib Go host-router** (the supervisor, PRD
§3.2) fronts `<app>.localhost` and owns transport, so the engine carries no
TLS/streaming/edge-auth code:

| Path        | Proxied to        | Notes |
| ----------- | ----------------- | ----- |
| `/`         | engine → `dist/`  | the app UI (open to the local operator) |
| `/api/*`    | engine → PocketBase REST | data (open to the local operator) |
| `/mcp`      | engine → MCP handler | **Streamable HTTP**; router streams it (`FlushInterval:-1`, no write deadline) |

Router responsibilities that simplify the engine:

- **No TLS in v1** — `*.localhost` is already a browser secure context (WebGPU/WebLLM work
  without certs). Real edge TLS (v2 remote reach) is added later by putting **Caddy** or
  Go `autocert` on `:443` *in front of* the router — the engine still speaks plain HTTP.
- **Edge auth for `/mcp`** — a **per-app bearer token** (generated at ship, persisted at
  `agent/.mcp_token`, shown to the operator to paste into their harness's MCP config —
  Hermes, Claude Cowork, Claude Desktop, ChatGPT, …). The router validates it (constant-
  time compare) and only then proxies; the engine trusts pre-authed requests. `/` and
  `/api` stay open for the local operator; only `/mcp` — the network-reachable surface —
  carries the token.
- **Reach is a bind choice** — loopback by default; `0.0.0.0` for LAN; a tunnel in front
  for web clients. The bearer is what makes binding beyond loopback safe.
- **Streaming** — `httputil.ReverseProxy` with immediate flush handles MCP's Streamable
  HTTP / SSE; no write deadline, so long-lived streams aren't cut.
- **Routing + lazy spawn** — host → engine port from the app registry; the engine is
  spawned on the first request to its host.

Because the MCP endpoint lives behind the same host as the UI and API, "the app" and "the
app's tools" are one origin — nothing extra to run, and the engine stays a thin data +
tool-logic server.

---

## 8. `agent.json` — providers & config

```json
{
  "instructions": "instructions.md",
  "mcp":  { "enabled": true,  "auth": "bearer" },
  "eve":  { "enabled": true,  "provider": "webllm", "model": "Qwen3.5-4B-Instruct-q4f16" },
  "cloud": { "enabled": false }
}
```

- `mcp` — the primary interface; on by default. `auth` selects the router's edge scheme.
- `eve` — the experimental in-browser assistant; `provider: "webllm"` + a model id
  (tiered by hardware, PRD §6.2). Set `enabled:false` to ship MCP-only.
- `cloud` — placeholder for the deferred direct-completions path (OpenRouter / BYO key).

---

## 9. Authoring flow

The agent is authored exactly like the app — conversation, not code:

1. Operator/builder to the harness: *"Let EVE create and close follow-ups, read
   companies for context, and never touch anything else."*
2. The harness, guided by `skills/edit-agent.md`, writes `instructions.md` (persona),
   `policy.json` (`followups`: read/create + gated update; `companies`: read; all else
   denied), and leaves `agent.json` defaults.
3. On boot the engine regenerates tools from policy + schema and (re)registers the
   `/mcp` route; the router already serves it. Nothing else to wire.

`skills/edit-agent.md` encodes the invariants a harness must respect: default-deny,
destructive ops gated, fields must exist on the collection, `filter` must be valid
PocketBase syntax, instructions must state what the agent may **not** do.

---

## 10. Open questions

- **Token distribution UX** — how the operator gets the per-app MCP bearer token into
  Claude Desktop (copy-paste vs a generated config snippet vs a deep link).
- **`@operator` in single-user v1** — is row-level `filter` worth wiring before there's
  more than one operator?
- **Custom-tool safety** — do authored `tools/*.js` run with full ORM access, or a
  restricted binding, given they're harness-written on a non-coder's behalf?
- **Resources vs tools** — also expose collections as MCP *resources* (read-only
  browsing) in addition to `list_/get_` tools, or keep the surface tools-only?
- **Policy for custom tools** — should `tools/*` also be default-deny and explicitly
  enabled in `policy.json`, or is presence in `tools/` enough?
