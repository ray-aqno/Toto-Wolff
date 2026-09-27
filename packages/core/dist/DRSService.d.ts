import type { DRSResult, DRSCheckInput } from './types.js';
import { HookExecutor, HookContext, HookResult } from './hooks/HookTypes.js';
import { VaultService } from './VaultService.js';
/** Where a resolved DRSConfig actually came from, surfaced so a resolution
 * failure (deny-all) is a visible signal, not an indistinguishable "everything
 * is blocked" state. */
type ConfigSource = 'cwd-relative' | 'env:TOTO_DRS_CONFIG' | 'deny-all-fallback';
/**
 * Deterministic boundary enforcement (Rules 1-5) for tool calls, usable as a
 * HookExecutor. Mirrors the bash PreToolUse hook's rules so both enforcement
 * paths give the same answer; tests/drs-conformance.bats asserts that they do.
 */
export declare class DRSService implements HookExecutor {
    readonly id = "drs";
    readonly name = "Drag Reduction System";
    readonly priority = 10;
    private readonly config;
    /** Diagnostic: where this instance's config actually came from. Public so
     * callers (and tests) can tell a resolution failure apart from a genuinely
     * empty-but-resolved config; see resolveDrsConfig(). */
    readonly configSource: ConfigSource;
    /** Audit-trail sink for overrides. Undefined is tolerated for construction
     * that never exercises an override, but without a vault no override is ever
     * honored (see check()); both live construction sites inject a real one. */
    private readonly vault;
    /**
     * Resolves the active config (explicit path, then TOTO_DRS_CONFIG, then the
     * cwd-relative .toto/drs-config.json). Never throws on a resolution failure:
     * it falls back to deny-all and reports that through `configSource`, so a
     * bad working directory is a visible signal rather than a silent allow-all.
     * `vault` receives an audit record for each accepted override.
     */
    constructor(configPath?: string, vault?: VaultService);
    /**
     * Resolves the active DRSConfig: an explicit configPath argument wins
     * outright; otherwise TOTO_DRS_CONFIG (env escape hatch) is tried; otherwise
     * `.toto/drs-config.json` relative to process.cwd(). A genuine resolution
     * failure at any of these falls back to DEFAULT_CONFIG's shape tagged
     * 'deny-all-fallback', never DEFAULT_CONFIG silently mislabeled as if it
     * were a real, permissive configuration.
     */
    private resolveDrsConfig;
    /**
     * Surfaces (via stderr, non-throwing) the case where resolution genuinely
     * failed and `permissive` isn't set to explicitly opt into the old
     * no-restriction behavior. Construction must never throw here (a resolution
     * failure from an unexpected cwd is a real, named scenario, not a bug to
     * crash on), so this only logs, it does not assert() in the throwing sense.
     */
    private validateNonPermissive;
    /**
     * Evaluates a tool call against the DRS rules; the first rule that fires
     * wins. Rules 1 (frozen path) and 5 (destructive pattern) run first and can
     * never be overridden. An "override drs: <reason>" message then bypasses
     * Rules 2/3/4, but only if its audit record is written to the vault first;
     * an override that can't be audited is ignored and the call is judged as if
     * none was given. Without an override, Rules 2 (scope), 3 (auth surface)
     * and 4 (tenant) apply. Returns `{ allowed: true }` when no rule fires.
     */
    check(input: DRSCheckInput): Promise<DRSResult>;
    /**
     * Writes a durable audit record for an accepted override, mirroring bash's
     * write_override_record() shape. check() is the sole choke point for this,
     * not the MCP handler, since execute() calls check() directly too,
     * bypassing the MCP handler entirely. Returns whether the record was
     * written: false when no vault is configured or the write fails (the
     * failure is also reported on stderr). check() treats false as "override
     * not honored": fail closed, so an override never takes effect without
     * its audit trail (the bash hook does the same).
     */
    private writeOverrideAuditRecord;
    /** HookExecutor implementation: converts HookContext to DRSCheckInput and runs check. */
    execute(context: HookContext): Promise<HookResult>;
    private checkOverride;
    private rule1_frozen;
    private rule2_scope;
    private rule3_auth;
    private rule4_tenant;
    private rule5_destructive;
    private matchGlob;
    private loadConfig;
}
export {};
//# sourceMappingURL=DRSService.d.ts.map