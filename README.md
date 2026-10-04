# toto-wolff 2.0 layout spike

This branch is a test, not a release. Do not install it.

It checks that a Claude Code plugin kept at the root of an orphan branch passes the Claude plugin directory's Validate step. The plugin is one skill (`hello`) and a dependency-free MCP server (`server/index.mts`) with one tool, `echo`.

## Requirements

- Node 24 or newer. Claude Code starts the server with `node server/index.mts`, and Node runs the TypeScript file directly by stripping its types. Older Node releases cannot load a `.ts` file, so the server will not start there.
- No credentials, settings, or network access.

## Behavior

- Speaks MCP over stdio as newline-delimited JSON-RPC 2.0.
- Answers `initialize`, `ping`, `tools/list` and `tools/call`; ignores notifications.
- Does not require `initialize` before other requests (spike scope).
- `echo` returns its `text` argument, cut to at most 1024 bytes.
- Lines longer than 1 MiB are rejected with one error, and the server keeps running.

Tracking issue: https://github.com/ray-aqno/Toto-Wolff/issues/57
