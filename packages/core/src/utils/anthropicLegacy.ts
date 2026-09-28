/**
 * Legacy Anthropic client creation — preserved for backward compatibility.
 * This is the original implementation from anthropic.ts before provider abstraction.
 * Delegates to ProviderFactory in new code; this file exists only for the
 * `createAnthropicClient()` backward-compat wrapper.
 */

import Anthropic from '@anthropic-ai/sdk';
import assert from 'node:assert';
import { readClaudeJsonEnv } from './claudeJsonCredentials.js';

const MCP_KEY = 'toto-wolff';

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
 * Resolution order (an empty-string/unset var never short-circuits the next tier):
 *   0. TOTO_ANTHROPIC_API_KEY / TOTO_ANTHROPIC_AUTH_TOKEN / TOTO_ANTHROPIC_BASE_URL,
 *      which .claude-plugin/plugin.json fills from the plugin's userConfig. They
 *      use their own names because Claude Code substitutes an unset optional
 *      userConfig value as an empty string, and an env entry named
 *      ANTHROPIC_API_KEY would overwrite a key the user exported in their shell.
 *      The base URL here pairs only with a credential from this same tier.
 *   1. process.env — used if at least one of the two vars is a non-empty string.
 *   2. ~/.claude.json mcpServers.toto-wolff.env — checked only when neither env
 *      var above resolved. This is a one-time synchronous file read at client
 *      construction (not per-request), so it does not sit on any hot path.
 *
 * At least one of {API_KEY, AUTH_TOKEN} must be resolved from either source.
 * ANTHROPIC_BASE_URL follows the same resolution: the environment wins, and
 * the file's baseUrl is used only when credentials themselves fell back to
 * the file — so a proxy's token and its own base URL travel together instead
 * of a stray env ANTHROPIC_BASE_URL pointing a file-sourced token at the
 * wrong endpoint.
 *
 * Credentials are passed explicitly (null disables the SDK's own env lookup)
 * so the assertion below is the single source of truth for required auth.
 * Neither credential is ever logged or reflected in error messages.
 */
export function createAnthropicClient(): Anthropic {
  const pluginApiKey = nonEmpty(process.env['TOTO_ANTHROPIC_API_KEY']);
  const pluginAuthToken = nonEmpty(process.env['TOTO_ANTHROPIC_AUTH_TOKEN']);
  if (pluginApiKey || pluginAuthToken) {
    return new Anthropic({
      apiKey: pluginApiKey ?? null,
      authToken: pluginAuthToken ?? null,
      baseURL: nonEmpty(process.env['TOTO_ANTHROPIC_BASE_URL']),
    });
  }

  let apiKey = process.env['ANTHROPIC_API_KEY'];
  let authToken = process.env['ANTHROPIC_AUTH_TOKEN'];
  let baseURL = process.env['ANTHROPIC_BASE_URL'];

  const haveEnvApiKey = typeof apiKey === 'string' && apiKey.length > 0;
  const haveEnvAuthToken = typeof authToken === 'string' && authToken.length > 0;

  if (!haveEnvApiKey && !haveEnvAuthToken) {
    const fromFile = readClaudeJsonEnv(MCP_KEY);
    apiKey = fromFile.apiKey;
    authToken = fromFile.authToken;
    baseURL = fromFile.baseUrl ?? baseURL;
  }

  assert(
    (typeof apiKey === 'string' && apiKey.length > 0) ||
      (typeof authToken === 'string' && authToken.length > 0),
    'ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN must be set and non-empty (checked plugin userConfig, shell environment and ~/.claude.json mcpServers.toto-wolff.env)',
  );
  return new Anthropic({ apiKey: apiKey ?? null, authToken: authToken ?? null, baseURL });
}

/** Returns the value if it is a non-empty string, otherwise undefined. */
function nonEmpty(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}