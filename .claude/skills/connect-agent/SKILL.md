---
name: connect-agent
description: Use when wiring an app's MCP server into an AI client so the operator can actually use it — "how do I connect this", "add it to Claude Desktop", "use it from Claude Code or Codex", or when an MCP connection fails. Covers the address, the token, per-client config, and the failures that look like bugs.
---

# Connecting a client to an app's MCP server

## The address and the token

```
http://localhost:8080/mcp/<app>          # bare localhost, path-routed
apps/<app>/agent/.mcp_token              # the bearer token (generated at first run)
```

**Use bare `localhost`, not `<app>.localhost`.** Browsers and curl map `*.localhost` to
loopback internally; **Node does not** — `dns.lookup("<app>.localhost")` returns
`ENOTFOUND`. Every Node-based MCP client fails against the host-routed URL unless the
machine has an `/etc/hosts` entry added with sudo. The path route exists to avoid that.

`/mcp` is the only authenticated path; the UI and `/api` stay open to the local operator.

Confirm the endpoint works before touching any client config:

```bash
curl -s -H "Authorization: Bearer $(cat apps/<app>/agent/.mcp_token)" \
  -H 'content-type: application/json' http://localhost:8080/mcp/<app> \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

No token should give `401`. If this curl fails, no client config will help.

## Claude Code — native HTTP, no bridge

```bash
claude mcp add --transport http <app> http://localhost:8080/mcp/<app> \
  --header "Authorization: Bearer $(cat apps/<app>/agent/.mcp_token)"
```

Claude Code speaks HTTP MCP directly, so none of the `mcp-remote` workarounds apply. This
also means **the session that builds an app can operate it** — no second tool. Project-scoped
config in `.mcp.json` at the repo root travels with the checkout; user-scoped does not.

## Claude Desktop — stdio only, needs a bridge

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{ "mcpServers": { "<app>": {
  "command": "npx",
  "args": ["-y", "mcp-remote", "http://localhost:8080/mcp/<app>",
           "--transport", "http-only", "--header", "Authorization:${AUTH}"],
  "env": { "AUTH": "Bearer <token>" }
} } }
```

Two non-obvious details: `Authorization:${AUTH}` has **no space** after the colon, because
`mcp-remote` splits `--header` on whitespace and the value must arrive via the env var; and
`--transport http-only` skips an SSE probe the engine does not implement. `--allow-http` is
**not** needed on bare `localhost`.

Back up the file before editing, merge into any existing `mcpServers` rather than replacing
it, and restart the app afterwards.

## Codex

`~/.codex/config.toml`. Recent versions accept a streamable-HTTP `url` with a bearer token
directly; older ones need the same `mcp-remote` stdio bridge as Claude Desktop. Check the
installed version rather than guessing — the config key names have changed across releases.

## When it fails

| Symptom | Cause |
| --- | --- |
| `ENOTFOUND` / cannot connect | using `<app>.localhost` with a Node client — switch to the path route |
| `401` | missing/wrong token, or a space after `Authorization:` |
| Server shows as failed | **the supervisor is not running** — the connector is dead without it |
| Lands on a page listing apps | the request hit the launcher: wrong path, or an unknown app name |
| Tools missing / wrong arguments | the client cached `tools/list` — **reconnect or restart it** |
| Writes rejected as `Invalid value x` | the client is guessing a `select` value; reconnect so it re-reads the schema, which advertises the allowed values as an `enum` |

**The supervisor must stay running** for any client to work. If it was started inside an AI
session, it stops when that session ends. For always-on, run it from a terminal the operator
controls, or install a launchd/systemd unit.

## After connecting

Tell the operator one concrete first request to try, phrased in their domain, so they can
confirm the tools work end to end rather than discovering a problem mid-task.
