import * as fs from 'node:fs';
import * as path from 'node:path';
import assert from 'node:assert';
import type { DRSResult, DRSCheckInput, DRSConfig, DRSRule, DRSTool } from './types.js';

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

export class DRSService {
  private readonly config: DRSConfig;

  constructor(configPath?: string) {
    this.config = configPath ? this.loadConfig(configPath) : DEFAULT_CONFIG;
    assert(this.config.freezePaths !== undefined, 'freezePaths required');
    assert(this.config.allowedPaths !== undefined, 'allowedPaths required');
    assert(this.config.tenantNamespaces !== undefined, 'tenantNamespaces required');
    assert(this.config.currentTenant !== undefined, 'currentTenant required');
    assert(this.config.haltPatterns !== undefined, 'haltPatterns required');
  }

  check(input: DRSCheckInput): DRSResult {
    assert(input !== undefined && input !== null, 'input required');
    assert(typeof input.tool === 'string', 'tool required');

    const overrideResult = this.checkOverride(input);
    if (overrideResult) return overrideResult;

    if (input.tool === 'Bash') {
      assert(typeof input.command === 'string', 'command required for Bash');
    } else {
      assert(typeof input.targetPath === 'string' && input.targetPath.length > 0, 'targetPath required');
    }

    // Rule 1: Frozen path
    const rule1 = this.rule1_frozen(input);
    if (rule1) return rule1;

    // Rule 2: Out of scope
    const rule2 = this.rule2_scope(input);
    if (rule2) return rule2;

    // Rule 3: Auth/permission surface
    const rule3 = this.rule3_auth(input);
    if (rule3) return rule3;

    // Rule 4: Cross-tenant
    const rule4 = this.rule4_tenant(input);
    if (rule4) return rule4;

    // Rule 5: Destructive shell pattern
    const rule5 = this.rule5_destructive(input);
    if (rule5) return rule5;

    return { allowed: true };
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
    if (this.config.allowedPaths.length === 0) return null;
    if (input.tool === 'Bash') return null;
    const target = input.targetPath ?? '';
    if (target.length === 0) return null;

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
    return target === pattern || target.startsWith(pattern + '/');
  }

  private loadConfig(configPath: string): DRSConfig {
    if (!fs.existsSync(configPath)) {
      return DEFAULT_CONFIG;
    }
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(content);
      return {
        freezePaths: Array.isArray(parsed.freeze) ? parsed.freeze : [],
        allowedPaths: Array.isArray(parsed.allowed_paths) ? parsed.allowed_paths : [],
        tenantNamespaces: Array.isArray(parsed.tenant_namespaces) ? parsed.tenant_namespaces : [],
        currentTenant: typeof parsed.current_tenant === 'string' ? parsed.current_tenant : '',
        haltPatterns: Array.isArray(parsed.halt_patterns) ? parsed.halt_patterns : DEFAULT_CONFIG.haltPatterns,
      };
    } catch {
      return DEFAULT_CONFIG;
    }
  }
}