#!/usr/bin/env bash
# Toto Wolff MCP demo client.
#
# Invokes the running MCP server's council_run and p10_plan tools over HTTP and
# prints each result, then points at the vault artifacts they produced. This is
# the on-stage driver: start the server, run this, watch the governed cycle fire.
#
# Usage:  ./scripts/demo.sh
# Needs:  the MCP server running ->  pnpm -C packages/mcp-server start
# Env:    TOTO_MCP_PORT    (default 3099)
#         TOTO_VAULT_PATH  (default ~/Documents/Obsidian Vault — shown for confirmation)
set -euo pipefail

PORT="${TOTO_MCP_PORT:-3099}"
BASE="http://127.0.0.1:${PORT}"
VAULT="${TOTO_VAULT_PATH:-${HOME}/Documents/Obsidian Vault}"

echo "toto-wolff MCP demo"
echo "  server: ${BASE}"
echo "  vault:  ${VAULT}"
echo

# Pretty-print JSON when python3 is available; otherwise pass through untouched.
pp() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -m json.tool 2>/dev/null || cat
  else
    cat
  fi
}

# Preflight: prove the server is listening. ANY HTTP response counts as up — we
# deliberately hit an input-requiring tool with no body, so a 400 is success here.
# Only a connection failure (curl non-zero) means the server is down.
if ! curl -s -o /dev/null --max-time 3 "${BASE}/p10_plan"; then
  echo "ERROR: no MCP server reachable at ${BASE}" >&2
  echo "Start it first:  pnpm -C packages/mcp-server start" >&2
  exit 1
fi

# call <tool> <json-body> — POST, print status + body, fail on any non-200.
# A blocked p10 ruling is still HTTP 200 (governance outcome, not a fault); its
# verdict shows in the body's "status" field.
call() {
  local tool="$1" payload="$2" resp code out
  echo "── POST /${tool}"
  resp="$(curl -s -w $'\n%{http_code}' --max-time 120 \
    -H 'Content-Type: application/json' \
    -d "${payload}" "${BASE}/${tool}")"
  code="${resp##*$'\n'}"
  out="${resp%$'\n'*}"
  echo "HTTP ${code}"
  printf '%s\n' "${out}" | pp
  echo
  if [ "${code}" != "200" ]; then
    echo "ERROR: /${tool} returned ${code}" >&2
    return 1
  fi
}

call council_run '{"question":"Should toto-wolff use a monorepo or polyrepo layout?"}'
call p10_plan    '{"task":"Add a health-check endpoint to the MCP server"}'

echo "Demo complete. Artifacts written to the vault:"
echo "  ${VAULT}/Council/Congressional-Records/"
echo "  ${VAULT}/P10-Plans/"
