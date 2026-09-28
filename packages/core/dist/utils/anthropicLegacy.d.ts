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
 * The base URL always comes from the same tier as the credential, never from
 * another one: a plugin or ~/.claude.json credential with no base URL of its
 * own goes to DEFAULT_BASE_URL, not to a shell ANTHROPIC_BASE_URL, so a
 * credential is never sent to a gateway it was not configured for.
 *
 * Credentials are passed explicitly (null disables the SDK's own env lookup)
 * so the assertion below is the single source of truth for required auth.
 * Neither credential is ever logged or reflected in error messages.
 */
export declare function createAnthropicClient(): Anthropic;
//# sourceMappingURL=anthropicLegacy.d.ts.map