# App template

Copy this folder to start a new app:

```bash
cp -R apps/_template apps/<name>
mv apps/<name>/pb_migrations/1700000000_init.js "apps/<name>/pb_migrations/$(date +%s)_init.js"
```

Then:

1. **Schema** — edit `pb_migrations/<ts>_init.js`: rename the collection, set its fields.
   Keep the rules open (`""`) for the single local operator.
2. **Policy** — edit `agent/policy.json`. It is **default-deny**: list only the collections
   and operations the AI may use. Tools are generated per allowed op (`list_`/`get_` for
   read, plus `create_`, `update_`, `delete_`).
3. **Instructions** — edit `agent/instructions.md`: persona + guardrails. Say explicitly
   what the agent may **not** do.
4. Restart the supervisor. The app is discovered and served at `<name>.localhost`, with
   `/api`, `/_/` (admin), and `/mcp` live. Schema applies automatically on boot.

Folders under `apps/` whose name starts with `_` (or `.`) are templates/scratch and are
**skipped by the supervisor**, so this one never runs as an app.
