import * as fs from 'node:fs';
import * as path from 'node:path';
import assert from 'node:assert';
import type { DRSResult, DRSCheckInput, DRSConfig } from './types.js';
import { HookExecutor, HookContext, HookResult } from './hooks/HookTypes.js';
import { VaultService } from './VaultService.js';

const DEFAULT_CONFIG: DRSConfig = {
  freezePaths: [],
  allowedPaths: [],
  tenantNamespaces: [],
  currentTenant: '',
  haltPatterns: ['TRUNCATE TABLE', 'git push --force'],
};

const AUTH_PATTERNS = [
  'auth',
  'permission',
  'role',
  'tenant',
  'policy',
  'rbac',
  'acl',
  'iam',
];

const DESTRUCTIVE_PATTERNS = [
  'rm -rf',
  'DROP TABLE',
  'DELETE FROM',
];

/** Where a resolved DRSConfig actually came from — surfaced so a resolution
 * failure (deny-all) is a visible signal, not an indistinguishable "everything
 * is blocked" state. */
type ConfigSource = 'cwd-relative' | 'env:TOTO_DRS_CONFIG' | 'deny-all-fallback';

/** Where the parsed freezePaths list actually came from. */
type FreezeSource = 'config' | 'freeze.json-fallback' | 'absent';

interface FreezeParseResult {
  paths: string[];
  keyPresent: boolean;
}

interface LoadedConfig {
  config: DRSConfig;
  freezeSource: FreezeSource;
  /** true only if configPath existed and parsed successfully. */
  resolved: boolean;
}

/**
 * Extracts a freeze-paths array from a parsed JSON value, tolerant of a bare
 * array or a `freeze_paths`/`freeze`/`frozen` key on an object. Distinguishes
 * "key present but empty" from "key absent" via `keyPresent` — a bare `[]`
 * result alone can't tell those apart, and callers need to.
 */
function parseFreezeConfig(raw: unknown): FreezeParseResult {
  if (Array.isArray(raw)) {
    return { paths: raw as string[], keyPresent: true };
  }
  if (raw !== null && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    for (const key of ['freeze_paths', 'freeze', 'frozen']) {
      if (Array.isArray(obj[key])) {
        return { paths: obj[key] as string[], keyPresent: true };
      }
    }
  }
  return { paths: [], keyPresent: false };
}

export class DRSService implements HookExecutor {
  readonly id = 'drs';
  readonly name = 'Drag Reduction System';
  readonly priority = 10;

  private readonly config: DRSConfig;
  /** Diagnostic: where this instance's config actually came from. Public so
   * callers (and tests) can tell a resolution failure apart from a genuinely
   * empty-but-resolved config — see resolveDrsConfig(). */
  readonly configSource: ConfigSource;
  /** Optional audit-trail sink for overrides. Undefined is tolerated (e.g.
   * test construction that never exercises an override path); both live
   * construction sites always inject a real instance. */
  private readonly vault: VaultService | undefined;

  constructor(configPath?: string, vault?: VaultService) {
    const resolved = this.resolveDrsConfig(configPath);
    this.config = resolved.config;
    this.configSource = resolved.source;
    this.vault = vault;
    assert(this.config.freezePaths !== undefined, 'freezePaths required');
    assert(this.config.allowedPaths !== undefined, 'allowedPaths required');
    assert(this.config.tenantNamespaces !== undefined, 'tenantNamespaces required');
    assert(this.config.currentTenant !== undefined, 'currentTenant required');
    assert(this.config.haltPatterns !== undefined, 'haltPatterns required');
    this.validateNonPermissive(this.config, this.configSource);
  }

  /**
   * Resolves the active DRSConfig: an explicit configPath argument wins
   * outright; otherwise TOTO_DRS_CONFIG (env escape hatch) is tried; otherwise
   * `.toto/drs-config.json` relative to process.cwd(). A genuine resolution
   * failure at any of these falls back to DEFAULT_CONFIG's shape tagged
   * 'deny-all-fallback' — never DEFAULT_CONFIG silently mislabeled as if it
   * were a real, permissive configuration.
   */
  private resolveDrsConfig(configPath: string | undefined): { config: DRSConfig; source: ConfigSource } {
    if (configPath !== undefined) {
      const loaded = this.loadConfig(configPath);
      return { config: loaded.config, source: loaded.resolved ? 'cwd-relative' : 'deny-all-fallback' };
    }

    const envPath = process.env['TOTO_DRS_CONFIG'];
    if (envPath !== undefined && envPath.length > 0) {
      const loaded = this.loadConfig(envPath);
      return loaded.resolved
        ? { config: loaded.config, source: 'env:TOTO_DRS_CONFIG' }
        : { config: DEFAULT_CONFIG, source: 'deny-all-fallback' };
    }

    const cwdPath = path.join(process.cwd(), '.toto', 'drs-config.json');
    const loaded = this.loadConfig(cwdPath);
    return loaded.resolved
      ? { config: loaded.config, source: 'cwd-relative' }
      : { config: DEFAULT_CONFIG, source: 'deny-all-fallback' };
  }

  /**
   * Surfaces (via stderr, non-throwing) the case where resolution genuinely
   * failed and `permissive` isn't set to explicitly opt into the old
   * no-restriction behavior — construction must never throw here (a resolution
   * failure from an unexpected cwd is a real, named scenario, not a bug to
   * crash on), so this only logs, it does not assert() in the throwing sense.
   */
  private validateNonPermissive(config: DRSConfig, source: ConfigSource): void {
    if (source === 'deny-all-fallback' && config.permissive !== true) {
      process.stderr.write(
        'DRSService: configuration resolution failed — falling back to deny-all ' +
        '(every Rule 2 check will block until this is fixed). Set permissive: true ' +
        'in your DRS config to opt into unrestricted mode instead, or ensure ' +
        '.toto/drs-config.json / TOTO_DRS_CONFIG resolves correctly.\n',
      );
    }
  }

  async check(input: DRSCheckInput): Promise<DRSResult> {
    assert(input !== undefined && input !== null, 'input required');
    assert(typeof input.tool === 'string', 'tool required');

    if (input.tool === 'Bash') {
      assert(typeof input.command === 'string', 'command required for Bash');
    } else {
      assert(typeof input.targetPath === 'string' && input.targetPath.length > 0, 'targetPath required');
    }

    // Rules 1 and 5 run before, and are exempt from, checkOverride(): Rule 1's
    // freeze list is a small, deliberately curated set an override shouldn't
    // defeat; Rule 5 already has its own narrower --force-confirmed override,
    // so a second, wider, message-based bypass for the same rule is redundant
    // and strictly increases blast radius for no gain. checkOverride() can
    // only bypass Rules 2/3/4.

    // Rule 1: Frozen path
    const rule1 = this.rule1_frozen(input);
    if (rule1) return rule1;

    // Rule 5: Destructive shell pattern
    const rule5 = this.rule5_destructive(input);
    if (rule5) return rule5;

    const overrideResult = this.checkOverride(input);
    if (overrideResult) {
      await this.writeOverrideAuditRecord(input, overrideResult);
      return overrideResult;
    }

    // Rule 2: Out of scope
    const rule2 = this.rule2_scope(input);
    if (rule2) return rule2;

    // Rule 3: Auth/permission surface
    const rule3 = this.rule3_auth(input);
    if (rule3) return rule3;

    // Rule 4: Cross-tenant
    const rule4 = this.rule4_tenant(input);
    if (rule4) return rule4;

    return { allowed: true };
  }

  /**
   * Writes a durable audit record for an accepted override, mirroring bash's
   * write_override_record() shape. check() is the sole choke point for this —
   * not the MCP handler — since execute() calls check() directly too,
   * bypassing the MCP handler entirely. A write failure is surfaced (stderr)
   * but does not revoke an already-accepted override: this stream's job is
   * closing the fabricated-audit-trail gap, not making a transient vault
   * write hiccup crash the governance workflow it's meant to protect.
   */
  private async writeOverrideAuditRecord(input: DRSCheckInput, result: DRSResult): Promise<void> {
    if (this.vault === undefined) return;
    const target = input.tool === 'Bash' ? (input.command ?? '') : (input.targetPath ?? '');
    const now = new Date();
    const slug = `${now.toISOString().replace(/[:.]/g, '-')}-drs-override`;
    const reason = result.overrideReason ?? '';
    const body = [
      '---',
      `date: "${now.toISOString().slice(0, 10)}"`,
      `tool: "${input.tool}"`,
      `target: "${target.replace(/"/g, '\\"')}"`,
      'override: true',
      `override_reason: "${reason.replace(/"/g, '\\"')}"`,
      '---',
      '',
      'DRS override accepted (TS/MCP path).',
      `Target: ${target}`,
      `Reason: ${reason}`,
      '',
    ].join('\n');
    try {
      await this.vault.write(`DRS/${slug}.md`, body);
    } catch (err) {
      process.stderr.write(`DRSService: failed to write override audit record — ${String(err)}\n`);
    }
  }

  /** HookExecutor implementation — converts HookContext to DRSCheckInput and runs check. */
  async execute(context: HookContext): Promise<HookResult> {
    const input: DRSCheckInput = {
      tool: context.tool as import('./types.js').DRSTool,
    };
    if (context.input.targetPath !== undefined) input.targetPath = context.input.targetPath as string;
    if (context.input.command !== undefined) input.command = context.input.command as string;
    if (context.metadata.messageBefore !== undefined) input.messageBefore = context.metadata.messageBefore as string;
    return await this.check(input);
  }

  private checkOverride(input: DRSCheckInput): DRSResult | null {
    if (!input.messageBefore) return null;
    const match = input.messageBefore.match(/override drs:\s*(.+)/i);
    if (!match) return null;
    const reason = match[1]?.trim();
    if (!reason || reason.length === 0) return null;
    return {
      allowed: true,
      override: true,
      overrideReason: reason,
    };
  }

  private rule1_frozen(input: DRSCheckInput): DRSResult | null {
    if (input.tool === 'Bash') return null;
    const target = input.targetPath ?? '';
    if (target.length === 0) return null;

    for (const freezePath of this.config.freezePaths) {
      if (this.matchGlob(target, freezePath)) {
        return {
          allowed: false,
          ruleFired: 1,
          reason: `Frozen path: ${freezePath}`,
        };
      }
    }
    return null;
  }

  private rule2_scope(input: DRSCheckInput): DRSResult | null {
    if (input.tool === 'Bash') return null;
    const target = input.targetPath ?? '';
    if (target.length === 0) return null;

    if (this.config.allowedPaths.length === 0) {
      // Fail-closed default: empty allowedPaths means "nothing allowed," not
      // "no restriction." permissive: true is the explicit, documented opt-out
      // that restores the old no-restriction behavior.
      if (this.config.permissive === true) return null;
      return {
        allowed: false,
        ruleFired: 2,
        reason: 'Out of scope: allowedPaths is empty and permissive mode is not enabled',
      };
    }

    let inScope = false;
    for (const allowed of this.config.allowedPaths) {
      if (this.matchGlob(target, allowed)) {
        inScope = true;
        break;
      }
    }
    if (!inScope) {
      return {
        allowed: false,
        ruleFired: 2,
        reason: `Out of scope: ${target} not in allowed paths`,
      };
    }
    return null;
  }

  private rule3_auth(input: DRSCheckInput): DRSResult | null {
    const target = input.tool === 'Bash' ? (input.command ?? '') : (input.targetPath ?? '');
    if (target.length === 0) return null;

    const lower = target.toLowerCase();
    for (const pattern of AUTH_PATTERNS) {
      if (lower.includes(pattern)) {
        return {
          allowed: false,
          ruleFired: 3,
          reason: `Auth/permission surface: ${pattern}`,
        };
      }
    }

    // Also check for chmod/chown/usermod in bash commands
    if (input.tool === 'Bash' && typeof input.command === 'string') {
      const cmd = input.command.toLowerCase();
      if (cmd.includes('chmod') || cmd.includes('chown') || cmd.includes('usermod') || cmd.includes('groupadd') || cmd.includes('setcap')) {
        return {
          allowed: false,
          ruleFired: 3,
          reason: 'Auth/permission surface: shell permission command',
        };
      }
    }

    return null;
  }

  private rule4_tenant(input: DRSCheckInput): DRSResult | null {
    if (this.config.tenantNamespaces.length === 0 || this.config.currentTenant.length === 0) {
      return null;
    }
    if (input.tool === 'Bash') return null;
    const target = input.targetPath ?? '';
    if (target.length === 0) return null;

    for (const tenant of this.config.tenantNamespaces) {
      if (tenant !== this.config.currentTenant && target.includes(tenant)) {
        return {
          allowed: false,
          ruleFired: 4,
          reason: `Cross-tenant write: ${tenant} (current: ${this.config.currentTenant})`,
        };
      }
    }
    return null;
  }

  private rule5_destructive(input: DRSCheckInput): DRSResult | null {
    if (input.tool !== 'Bash') return null;
    const cmd = input.command ?? '';
    if (cmd.length === 0) return null;

    // Check for override first (already done in checkOverride, but double-check)
    if (cmd.includes('--force-confirmed')) return null;

    // rm -rf
    if (/\brm\s+-rf\b/.test(cmd)) {
      return { allowed: false, ruleFired: 5, reason: 'Destructive: rm -rf' };
    }

    // DROP TABLE
    if (/DROP\s+TABLE\b/i.test(cmd)) {
      return { allowed: false, ruleFired: 5, reason: 'Destructive: DROP TABLE' };
    }

    // DELETE FROM without WHERE
    const deleteMatch = cmd.match(/DELETE\s+FROM\s+\w+/i);
    if (deleteMatch && !/WHERE\b/i.test(cmd)) {
      return { allowed: false, ruleFired: 5, reason: 'Destructive: DELETE FROM without WHERE' };
    }

    // Custom halt patterns
    for (const pattern of this.config.haltPatterns) {
      if (cmd.includes(pattern)) {
        return { allowed: false, ruleFired: 5, reason: `Destructive: ${pattern}` };
      }
    }

    return null;
  }

  private matchGlob(target: string, pattern: string): boolean {
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(target);
    }
    const prefix = pattern.endsWith('/') ? pattern : pattern + '/';
    return target === pattern || target.startsWith(prefix);
  }

  private loadConfig(configPath: string): LoadedConfig {
    if (!fs.existsSync(configPath)) {
      return { config: DEFAULT_CONFIG, freezeSource: 'absent', resolved: false };
    }
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const parsed: unknown = JSON.parse(content);

      const primary = parseFreezeConfig(parsed);
      let freezePaths = primary.paths;
      let freezeSource: FreezeSource = primary.keyPresent ? 'config' : 'absent';

      // Check adjacent freeze.json if freezePaths is empty
      if (freezePaths.length === 0) {
        const freezeJsonPath = path.join(path.dirname(configPath), 'freeze.json');
        if (fs.existsSync(freezeJsonPath)) {
          try {
            const freezeContent = fs.readFileSync(freezeJsonPath, 'utf-8');
            const parsedFreeze: unknown = JSON.parse(freezeContent);
            const fallback = parseFreezeConfig(parsedFreeze);
            if (fallback.paths.length > 0) {
              freezePaths = fallback.paths;
              freezeSource = 'freeze.json-fallback';
            }
          } catch {
            // Ignore freeze.json read failure
          }
        }
      }

      const obj = (parsed !== null && typeof parsed === 'object') ? parsed as Record<string, unknown> : {};
      const config: DRSConfig = {
        freezePaths,
        allowedPaths: Array.isArray(obj['allowed_paths']) ? obj['allowed_paths'] as string[] : (Array.isArray(obj['allowedPaths']) ? obj['allowedPaths'] as string[] : []),
        tenantNamespaces: Array.isArray(obj['tenant_namespaces']) ? obj['tenant_namespaces'] as string[] : (Array.isArray(obj['tenantNamespaces']) ? obj['tenantNamespaces'] as string[] : []),
        currentTenant: typeof obj['current_tenant'] === 'string' ? obj['current_tenant'] : (typeof obj['currentTenant'] === 'string' ? obj['currentTenant'] : ''),
        haltPatterns: Array.isArray(obj['halt_patterns']) ? obj['halt_patterns'] as string[] : (Array.isArray(obj['haltPatterns']) ? obj['haltPatterns'] as string[] : DEFAULT_CONFIG.haltPatterns),
        ...(typeof obj['permissive'] === 'boolean' ? { permissive: obj['permissive'] } : {}),
      };

      return { config, freezeSource, resolved: true };
    } catch {
      return { config: DEFAULT_CONFIG, freezeSource: 'absent', resolved: false };
    }
  }
}