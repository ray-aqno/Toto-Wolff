# toto-wolff plugin (2.0, in development)

This folder is the Claude Code plugin. On the `v2` branch it is a work in progress for toto-wolff 2.0: do not install from `v2`. Released versions ship from `main` (1.6.x) and, from 2.0.0 on, from the `plugin` branch.

## Requirements

- **Node 24 or newer.** Claude Code starts the MCP server with `node ${CLAUDE_PLUGIN_ROOT}/server/index.mts`, and Node runs the TypeScript files directly by stripping their types. There is no build step and nothing to install.
- On Node 22.18 to 23.x the server stops at once with `toto-wolff needs Node 24+`.
- Below Node 22.18, Node cannot load a TypeScript file at all, so the server fails before that message can print. This README is the only warning there.
- No API key, token or other credential. The server makes no model calls: Claude runs the governance workflows through the plugin's skills.

## The MCP server

`server/` holds readable `.mts` files with no dependencies beyond Node's built-in modules. The `.mts` extension makes them ES modules whatever `package.json` sits above the plugin cache. The server speaks MCP over stdio as newline-delimited JSON-RPC 2.0, one message per line (no batches), in two protocol eras at once:

- **MCP 2026-07-28 (current, stateless).** Used for any request whose `params._meta` carries `io.modelcontextprotocol/protocolVersion` or `io.modelcontextprotocol/clientCapabilities`. The server answers `server/discover`, `tools/list` and `tools/call`; every result carries `resultType` and the server's name and version in `_meta`; `server/discover` and `tools/list` carry `ttlMs: 300000` and `cacheScope: "public"`. Both `_meta` fields are required (`-32602` if either is missing or the wrong type), and a protocol version other than `2026-07-28` gets `-32022` with the supported list. `tools/list` returns every tool in one page, so any `cursor` is `-32602`. `ping` and `initialize` do not exist in this revision (`-32601`), and a `null` request id is `-32600`.
- **MCP 2025-11-25 (the initialize handshake).** Used for every other request: `initialize`, `ping`, `tools/list` and `tools/call`, exactly as before.

The server keeps no state between requests, so the two eras can interleave on one connection. Claude Code 2.1.206 speaks only the handshake. Claude Code 2.1.289 probes with `server/discover` and stays on 2026-07-28, but only for accounts where its stdio protocol negotiation is switched on (a server-side feature flag); otherwise it uses the handshake. `pnpm check:modern-mcp` verifies the modern path with the installed Claude Code.

## Tools

Six tools carry over from v1 (issue #60). Each returns its result as JSON text, in both protocol eras. Invalid arguments are `-32602`.

| Tool | Arguments | Result |
|---|---|---|
| `vault_write` | `path` (relative to the vault, no `..`), `content` | `{ "path": ... }` |
| `vault_search` | `query` (1 to 500 characters) | `{ "results": [{ "file", "line", "text" }], "truncated": false }` |
| `drs_check` | `tool` (`Write`, `Edit`, `NotebookEdit`, `Bash`), `target_path` or `command`, optional `message_before` | the DRS verdict |
| `subagent_list` | optional `scope` (`user`, `project`, `both`) | the subagents found |
| `dashboard_status` | none | vault record counts and recent items |
| `score_confidence` | `ruling` | `{ "tier", "matchCount", "disqualifiers" }` |

The five v1 model-backed tools (`council_run`, `p10_plan`, `cabinet_run`, `safety_car_run`, `karpathy_check`) are gone for good; the matching skills already run those workflows through Claude itself. The graph and loop tools arrive in issues #61 to #63.

### The vault

- **Location:** `TOTO_VAULT_PATH`, else `$HOME/.toto/vault`. It must be an absolute path, or the server stops with one line on stderr. One server process serves one vault.
- **Git is optional.** If the vault is a git repository, each write is committed after it lands. Commits are best effort: if git is missing, the vault is not a repository, or the commit fails (for example, no `user.email`), the file stays written and uncommitted, and a failure prints one warning on stderr. Two Claude sessions writing to the same git vault can contend for git's lock, so one commit may be skipped or may include the other session's staged file.
- **Search is built in** (no ripgrep). It matches the query as literal, case-sensitive text, not a regular expression. When nothing matches and the query contains regex characters (`| [ ] ( ) * + ? ^ $ \`), the result carries a `note` saying so. Paths are absolute: the vault path as given, joined with the file's path inside it (symbolic links are not resolved). Entries whose name starts with `.` (`.git`, `.obsidian`) are skipped, and symbolic links inside the vault are not followed, so linked notes are not searched.
- **Search caps:** at most 500 results, files over 1 MiB skipped, and at most 512 KiB of results. If any cap fires, `truncated` is `true`. One file over 1 MiB in the vault therefore makes every search report `truncated: true`.

### DRS

`drs_check` reads its config from `TOTO_DRS_CONFIG`, else `.toto/drs-config.json` under the server's working directory (the directory Claude Code starts it in). Without a config, DRS falls back to deny-all: every `Write`, `Edit` and `NotebookEdit` target is out of scope (Rule 2), and one warning is printed the first time `drs_check` runs. An override (`message_before: "override drs: <reason>"`) is honored only once its audit record is written to the vault's `DRS/` folder; the commit after it is best effort like any other.

### Dashboard (off by default)

The dashboard HTTP server starts only when `TOTO_MCP_PORT` is set to a port from 1 to 65535 (every Claude session runs its own server, so there is no default port to fight over). It listens on `127.0.0.1` only and serves only GET routes: `/dashboard`, `/dashboard/events`, `/dashboard/record`, `/vault/reversed` and `/vault/signal`. A request whose `Host` header is not `127.0.0.1:<port>` or `localhost:<port>` gets 403, which blocks DNS rebinding from web pages. Any program on this machine can still read vault records through `/dashboard/record`, so turn the dashboard on only where that is acceptable. If the port is in use or not allowed, the server prints one warning and the MCP tools keep working. v1's POST tool routes (calling tools over HTTP) are removed.

Tracking issue: https://github.com/ray-aqno/Toto-Wolff/issues/57
