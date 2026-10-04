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

Its tool list is empty for now. The 2.0 tools arrive in later steps: vault, `drs_check`, dashboard, `score_confidence` and `subagent_list` (issue #60), then the graph and loop tools (issues #61 to #63). The five v1 model-backed tools (`council_run`, `p10_plan`, `cabinet_run`, `safety_car_run`, `karpathy_check`) are gone for good; the matching skills already run those workflows through Claude itself.

Tracking issue: https://github.com/ray-aqno/Toto-Wolff/issues/57
