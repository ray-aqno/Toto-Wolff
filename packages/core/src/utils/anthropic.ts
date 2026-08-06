import Anthropic from '@anthropic-ai/sdk';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CLAUDE_JSON_PATH = path.join(os.homedir(), '.claude.json');
const MCP_KEY = 'toto-wolff';

interface ClaudeJsonCredentials {
  apiKey?: string | undefined;
  authToken?: string | undefined;
}

/**
 * Read ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN from ~/.claude.json's
 * mcpServers["toto-wolff"].env, mirroring the `toto doctor` CLI's fallback
 * (packages/cli/src/commands/doctor.ts:readTokenFromClaudeJson). Synchronous
 * and never throws — a missing file, malformed JSON, or missing keys is a
 * normal "not found here" outcome, not an error of its own.
 */
function readClaudeJsonCredentials(): ClaudeJsonCredentials | undefined {
  try {
    const raw = fs.readFileSync(CLAUDE_JSON_PATH, 'utf8');
    const json = JSON.parse(raw) as Record<string, unknown>;
    const servers = json['mcpServers'] as Record<string, unknown> | undefined;
    const entry = servers?.[MCP_KEY] as Record<string, unknown> | undefined;
    const env = entry?.['env'] as Record<string, string> | undefined;
    if (!env) {
      return undefined;
    }
    return { apiKey: env['ANTHROPIC_API_KEY'], authToken: env['ANTHROPIC_AUTH_TOKEN'] };
  } catch {
    return undefined;
  }
}

/**
 * Construct the Anthropic client from environment, accepting either auth scheme,
 * falling back to ~/.claude.json's mcpServers.toto-wolff.env when neither is set
 * in the shell environment (mirrors the `toto doctor` CLI check — see
 * packages/cli/src/commands/doctor.ts). This lets a credential wired once during
 * ./setup's mcpServers config be honored everywhere, without a separate shell export.
 *
 * Two ways to authenticate:
 *   1. ANTHROPIC_API_KEY — direct API key (the common case for individual users).
 *   2. ANTHROPIC_AUTH_TOKEN + ANTHROPIC_BASE_URL — Bearer token routed through a
 *      proxy (e.g. a self-hosted gateway or org-internal relay).
 *
 * Resolution order (env wins over file; an empty-string/unset env var does NOT
 * short-circuit the file fallback):
 *   1. process.env — used if at least one of the two vars is a non-empty string.
 *   2. ~/.claude.json mcpServers.toto-wolff.env — checked only when neither env
 *      var above resolved. This is a one-time synchronous file read at client
 *      construction (not per-request), so it does not sit on any hot path.
 *
 * At least one of {API_KEY, AUTH_TOKEN} must be resolved from either source. The
 * SDK reads ANTHROPIC_BASE_URL from the environment on its own when baseURL is
 * unset, so proxy users do not need to wire it in here.
 *
 * Credentials are passed explicitly (null disables the SDK's own env lookup)
 * so the assertion below is the single source of truth for required auth.
 * Neither credential is ever logged or reflected in error messages.
 */
export function createAnthropicClient(): Anthropic {
  let apiKey = process.env['ANTHROPIC_API_KEY'];
  let authToken = process.env['ANTHROPIC_AUTH_TOKEN'];

  const haveEnvApiKey = typeof apiKey === 'string' && apiKey.length > 0;
  const haveEnvAuthToken = typeof authToken === 'string' && authToken.length > 0;

  if (!haveEnvApiKey && !haveEnvAuthToken) {
    const fromFile = readClaudeJsonCredentials();
    apiKey = fromFile?.apiKey;
    authToken = fromFile?.authToken;
  }

  assert(
    (typeof apiKey === 'string' && apiKey.length > 0) ||
      (typeof authToken === 'string' && authToken.length > 0),
    'ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN must be set and non-empty (checked shell environment and ~/.claude.json mcpServers.toto-wolff.env)',
  );
  return new Anthropic({ apiKey: apiKey ?? null, authToken: authToken ?? null });
}
