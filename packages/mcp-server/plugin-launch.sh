#!/usr/bin/env sh
# Launch command for the toto-wolff Claude Code plugin's MCP server.
#
# Fresh marketplace installs have no dist/ (gitignored, no build step runs)
# AND no node_modules (nothing runs `pnpm install` either) — so this script
# installs workspace dependencies once, gated on node_modules being absent,
# before launching the server from TypeScript source via tsx. Subsequent
# launches skip straight to the tsx exec.
set -e

PLUGIN_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PLUGIN_ROOT"

if [ ! -d node_modules ]; then
  npx --yes pnpm@11.5.1 install --frozen-lockfile
fi

exec npx --yes tsx@4.22.4 \
  --tsconfig "$PLUGIN_ROOT/packages/mcp-server/tsconfig.plugin.json" \
  "$PLUGIN_ROOT/packages/mcp-server/src/index.ts"
