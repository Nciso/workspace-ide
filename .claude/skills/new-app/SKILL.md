---
name: new-app
description: Use when creating a new app in this workspace — "make me an app for X", "scaffold a new app", "add an app called Y". Copies the template, writes the four files that must stay in lockstep (schema, policy, instructions, views), verifies safely, and reports the URLs. Run design-app first if what to build is not settled.
---

# Creating a new app

An app is a folder under `apps/<name>/`. Four files define it and **they move together** —
changing one without the others is how apps break silently.

| File | Defines | If you skip it |
| --- | --- | --- |
| `pb_migrations/<ts>_init.js` | collections + fields | nothing exists |
| `agent/policy.json` | what the AI may do | default-deny: no tools at all |
| `agent/instructions.md` | persona + guardrails | agent improvises |
| `views.json` | the operator UI | one plain table per collection |

## Scaffold

```bash
cp -R apps/_template apps/<name>
mv apps/<name>/pb_migrations/1700000000_init.js "apps/<name>/pb_migrations/$(date +%s)_init.js"
```

Folders starting with `_` or `.` are skipped by the supervisor, so the template never runs
as an app.

## Write the four files

**Schema.** Keep all five rules open (`listRule`/`viewRule`/`createRule`/`updateRule`/
`deleteRule: ""`) — this is a single local operator, and the MCP tools execute through the
API, so a nil rule locks the agent out too. Give every lifecycle a `select` with explicit
`values` in work order. Add a `select` for the operator's recurring judgment. Prefer
constraints over prose: a unique index on an external key makes duplicates impossible.

**Policy.** Default-deny; grant the least that makes the loop work:

```json
{ "defaults": { "read": false, "create": false, "update": false, "delete": false },
  "collections": { "<coll>": { "read": true, "create": true, "update": true } } }
```

Deletion is almost never right — a `Skipped`/`Archived` state is reversible and auditable.

**Instructions.** Persona, the loop, and explicitly what the agent may **not** do. State
that the agent never performs outward-facing acts (sending, paying, publishing); it
records that the operator did. Note that `select` fields take their exact declared value.

**Views.** The first view is the **work queue** — what the operator opens each morning.
It must have:

- `filter` — only rows that need action (server-side, a PocketBase expression)
- `sort` — what to do first
- `detail` — every long-form field, so the work product is readable and copyable
- `actions` — one click to mark work done

```json
{ "id": "queue", "type": "table", "title": "To do",
  "collection": "<coll>", "filter": "status = \"Draft\"", "sort": "created",
  "columns": ["name", "status"],
  "detail": ["body", "rationale"],
  "actions": [
    { "label": "Mark done", "set": { "status": "Done", "done_at": "@now" },
      "also": { "via": "<relation field>", "collection": "<other>",
                "set": { "last_touched_at": "@now" }, "increment": { "touches": 1 } } }
  ] }
```

`@now` is a UTC timestamp; `increment` adds to the stored value; `also` patches the record
across a relation in the same click, which is how two-sided bookkeeping stays consistent
between the UI and the agent.

## Verify — never against real data

If the app already holds the operator's records, **copy it first** and verify the copy:

```bash
cp -R apps/<name> apps/_smoke && rm -rf apps/_smoke/pb_data
WORKSPACE_DIR=apps/_smoke PORT=8099 ./workspace   # any free port
```

Never create, update, or click an action against an app the operator is actually using —
a missed cleanup means they believe work happened that did not. Delete `apps/_smoke` after.

For a brand-new empty app, verifying in place is fine. Check:

1. `go build -o workspace . && go build -o supervisor ./cmd/supervisor`
2. Start the supervisor; confirm the app appears in the log with its MCP address.
3. `tools/list` over MCP returns exactly the tools the policy allows — no more.
4. Create one record through a tool, confirm it appears in the work-queue view, then
   delete it.

## Report back

Give the operator: the app URL (`http://<name>.localhost:8080/`), the admin URL (`/_/`),
the **MCP address `http://localhost:8080/mcp/<name>`** and where the token lives
(`apps/<name>/agent/.mcp_token`). Then run **connect-agent** to wire their client.

A **new app folder requires restarting the supervisor** to be discovered.
