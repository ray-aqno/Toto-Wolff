/**
 * Legacy Anthropic client creation — preserved for backward compatibility.
 * This is the original implementation from anthropic.ts before provider abstraction.
 * Delegates to ProviderFactory in new code; this file exists only for the
 * `createAnthropicClient()` backward-compat wrapper.
 */
import Anthropic from '@anthropic-ai/sdk';
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
export declare function createAnthropicClient(): Anthropic;
//# sourceMappingURL=anthropicLegacy.d.ts.map