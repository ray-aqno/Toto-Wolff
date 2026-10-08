#!/usr/bin/env bash
# Local check (not CI): proves Claude Code speaks MCP 2026-07-28 to the
# plugin's server without falling back to the 2025-11-25 initialize handshake.
# Runs Claude Code's own `mcp list` against a temporary copy of the plugin
# whose launch command logs every message Claude Code sends, then checks it.
#
# Claude Code's stdio protocol negotiation is behind server-side feature flags
# (tengu_mcp_protocol_negotiation_stdio, tengu_mcp_stateless_skip_init; seen
# on 2.1.289, 2026-10-04), so a clean environment such as a CI runner always
# gets the legacy handshake. This script seeds only those two flags into a
# throwaway HOME. If Claude Code renames them, the check fails loudly with
# "never sent server/discover". Run it before each release; CI covers the
# modern protocol through tests/plugin-server instead.
#
# Usage: check-modern-mcp.sh <plugin-dir> [expected-claude-version-prefix]
# (no version prefix: any Claude Code version is accepted)
# CLAUDE_BIN overrides the Claude Code command (default: claude); the local
# negative controls use it to substitute a fake.
set -euo pipefail
read -r -a CLAUDE <<<"${CLAUDE_BIN:-claude}"
# A throwaway HOME: Claude Code loads no user settings, plugins or MCP servers
# (on a developer machine it would otherwise start every one of them), so only
# the plugin under test runs and no other server can share its name.
HOME=$(mktemp -d)
export HOME
echo '{"cachedGrowthBookFeatures":{"tengu_mcp_protocol_negotiation_stdio":true,"tengu_mcp_stateless_skip_init":true}}' > "$HOME/.claude.json"
PLUGIN_SRC=${1:?plugin dir}
WANT_VERSION=${2:-}

GOT_VERSION=$("${CLAUDE[@]}" --version)
case "$GOT_VERSION" in
  "$WANT_VERSION"*) ;;
  *) echo "::error::expected Claude Code $WANT_VERSION, got $GOT_VERSION"; exit 1 ;;
esac

WORK=$(mktemp -d)
LOG=$(mktemp)
cp -R "$PLUGIN_SRC" "$WORK/plugin"
MANIFEST="$WORK/plugin/.claude-plugin/plugin.json"
jq --arg log "$LOG" \
  '.mcpServers["toto-wolff"] = {command: "sh", args: ["-c", ("tee -a \"" + $log + "\" | node \"${CLAUDE_PLUGIN_ROOT}/server/index.mts\"")]}' \
  "$PLUGIN_SRC/.claude-plugin/plugin.json" > "$MANIFEST"
PLUGIN_NAME=$(jq -r '.name' "$MANIFEST")

# Claude's exit code is recorded, not trusted: another configured server
# failing must not decide this check, and the assertions below always run.
code=0
OUT=$(cd "$WORK" && timeout 120 "${CLAUDE[@]}" --plugin-dir "$WORK/plugin" mcp list 2>&1) || code=$?
echo "$OUT"
echo "claude mcp list exit code: $code"

if [ ! -s "$LOG" ]; then
  echo "::error::the server received nothing: the capture log is empty"; exit 1
fi
count() { jq -R --arg m "$1" 'fromjson? | select(type == "object" and .method == $m)' "$LOG" | jq -s 'length'; }
DISCOVER=$(count server/discover)
INITIALIZE=$(count initialize)
echo "server/discover sent: $DISCOVER, initialize sent: $INITIALIZE"
if [ "$DISCOVER" -lt 1 ]; then
  echo "::error::Claude Code never sent server/discover"; exit 1
fi
if [ "$INITIALIZE" -ne 0 ]; then
  echo "::error::Claude Code fell back to initialize: the server was not recognized as MCP 2026-07-28"; exit 1
fi
if ! grep -q "plugin:${PLUGIN_NAME}:toto-wolff: .*Connected" <<<"$OUT"; then
  echo "::error::plugin:${PLUGIN_NAME}:toto-wolff is not Connected"; exit 1
fi
echo "Modern MCP check passed: discover, no initialize, Connected."
