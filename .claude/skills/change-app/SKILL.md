---
name: change-app
description: Use when modifying an app that already exists — adding a field or collection, changing a lifecycle, adjusting what the AI may do, or reworking the views. Covers additive migrations, keeping the four files in lockstep, and what actually needs a reload vs a restart vs a rebuild.
---

# Changing an existing app

The app may already hold the operator's real records. Two rules follow from that:
**migrations are additive**, and **you verify against a copy, never their data**.

## Additive migrations only

Never edit a migration that has already run — it is applied history, and editing it makes
the file disagree with the database. Add a new one:

```bash
touch "apps/<name>/pb_migrations/$(date +%s)_<what_changed>.js"
```

Use `app.findCollectionByNameOrId(...)`, mutate, `app.save(...)`, and write the matching
`down` branch. Adding a field is safe. Renaming or removing one loses data — say so and
get an explicit yes first. New `select` values are safe to append; **removing** one
orphans existing rows holding it.

## Keep the four files in lockstep

A schema change almost always implies the other three. Walk the list every time:

| Changed | Then also check |
| --- | --- |
| Added a field | Should the agent be able to write it? Should it appear in `columns` or `detail`? |
| Added a collection | `policy.json` entry (default-deny means it is invisible otherwise), a view, and a mention in `instructions.md` |
| Changed a lifecycle's values | Board columns follow automatically, but `filter`s naming old values silently match nothing |
| Widened what the AI may do | `instructions.md` must say when to use it — and when not to |

The classic failure is adding a field and forgetting `views.json`: the data is captured
and the operator can never see it. If a field is worth storing, it is worth showing
somewhere.

## What takes effect when

| You changed | To see it |
| --- | --- |
| `views.json` | **reload the page** — served per `/manifest` request |
| `agent/policy.json` | **live** (read per tool call) — but reconnect the MCP client, it caches `tools/list` |
| `agent/instructions.md` | **reconnect the MCP client** — read at `initialize` |
| `pb_migrations/*` | **restart the engine** — migrations apply on boot |
| a new `apps/<name>/` folder | **restart the supervisor** — apps are discovered at startup |
| `main.go`, `cmd/supervisor/*` | `go build -o workspace . && go build -o supervisor ./cmd/supervisor`, then restart |
| `ui/src/*` | `cd ui && npm run build` (regenerates `ui/dist`), then `go build -o workspace .` — the engine embeds the bundle — then restart, then hard-reload the page |

**Stale tool schemas are the most confusing failure.** MCP clients cache `tools/list`. After
changing policy or the engine's tool generation, an unreconnected client keeps calling the
old shape and the errors look like the app is broken. Reconnect first, then debug.

## Some changes belong in the engine, not the app

If the app cannot express something because the *tool surface* lacks it — no filter, no way
to describe a field type, no expansion of relations — that is `main.go`, not the app
folder. Say so plainly rather than working around it in the schema, and note that the fix
affects **every** app, so it needs its own verification.

## Verify against a copy

```bash
cp -R apps/<name> apps/_smoke && rm -rf apps/_smoke/pb_data   # fresh DB, same schema
WORKSPACE_DIR=apps/_smoke PORT=8099 ./workspace
```

Exercise the change there: run the migration, list the tools, create and update a record,
open the view. Then `rm -rf apps/_smoke`. Never click an action or write a record in an app
the operator is using — if a cleanup is missed they will believe work happened that did
not. If you do touch real data, say so immediately and restore it.

Finish by telling the operator exactly which of the "takes effect when" steps they need.
