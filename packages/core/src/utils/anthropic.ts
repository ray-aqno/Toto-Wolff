import Anthropic from '@anthropic-ai/sdk';
import assert from 'node:assert';

/**
 * Construct the Anthropic client from environment, accepting either auth scheme.
 *
 * Two ways to authenticate:
 *   1. ANTHROPIC_API_KEY — direct API key (the common case for individual users).
 *   2. ANTHROPIC_AUTH_TOKEN + ANTHROPIC_BASE_URL — Bearer token routed through a
 *      proxy (e.g. a self-hosted gateway or org-internal relay).
 *
 * At least one of {API_KEY, AUTH_TOKEN} must be set. The SDK reads
 * ANTHROPIC_BASE_URL from the environment on its own when baseURL is unset,
 * so proxy users do not need to wire it in here.
 *
 * Credentials are passed explicitly (null disables the SDK's own env lookup)
 * so the assertion below is the single source of truth for required auth.
 * Neither credential is ever logged or reflected in error messages.
 */
export function createAnthropicClient(): Anthropic {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  const authToken = process.env['ANTHROPIC_AUTH_TOKEN'];
  assert(
    (typeof apiKey === 'string' && apiKey.length > 0) ||
      (typeof authToken === 'string' && authToken.length > 0),
    'ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN must be set and non-empty',
  );
  return new Anthropic({ apiKey: apiKey ?? null, authToken: authToken ?? null });
}
