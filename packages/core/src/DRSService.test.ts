import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DRSService } from './DRSService.js';
import { VaultService } from './VaultService.js';
import { HookSystem } from './hooks/HookSystem.js';
import type { HookContext, HookSystemConfig } from './hooks/HookTypes.js';

let testDir: string;
let originalCwd: string;

beforeEach(async () => {
  originalCwd = process.cwd();
  testDir = await mkdtemp(join(tmpdir(), 'toto-drs-'));
});

afterEach(async () => {
  process.chdir(originalCwd);
  delete process.env['TOTO_DRS_CONFIG'];
  await rm(testDir, { recursive: true, force: true });
});

async function writeFixtureConfig(dir: string, config: Record<string, unknown>): Promise<void> {
  await mkdir(join(dir, '.toto'), { recursive: true });
  await writeFile(join(dir, '.toto', 'drs-config.json'), JSON.stringify(config), 'utf8');
}

async function writeFixtureFreeze(dir: string, frozen: string[]): Promise<void> {
  await mkdir(join(dir, '.toto'), { recursive: true });
  await writeFile(join(dir, '.toto', 'freeze.json'), JSON.stringify({ frozen }), 'utf8');
}

// Council's standing rule: any service that can return allowed/pass/clear
// must have a test constructing it the way production does (zero-arg),
// proving a known-bad input is caught.
describe('DRSService — zero-arg construction, production shape', () => {
  it('Rule 1 fires on a frozen-path write', async () => {
    await writeFixtureFreeze(testDir, ['secrets/keys.json']);
    await writeFixtureConfig(testDir, { allowed_paths: ['secrets/'], tenant_namespaces: [], current_tenant: '', halt_patterns: [] });
    process.chdir(testDir);

    const drs = new DRSService();
    const result = await drs.check({ tool: 'Write', targetPath: 'secrets/keys.json' });

    expect(result.allowed).toBe(false);
    expect(result.ruleFired).toBe(1);
  });

  it('Rule 2 fires on an out-of-scope write', async () => {
    await writeFixtureConfig(testDir, { allowed_paths: ['src/'], tenant_namespaces: [], current_tenant: '', halt_patterns: [] });
    process.chdir(testDir);

    const drs = new DRSService();
    const result = await drs.check({ tool: 'Write', targetPath: 'outside/file.ts' });

    expect(result.allowed).toBe(false);
    expect(result.ruleFired).toBe(2);
  });

  it('Rule 4 fires on a cross-tenant write', async () => {
    await writeFixtureConfig(testDir, {
      allowed_paths: ['workspaces/'],
      tenant_namespaces: ['acme-corp', 'widgetco'],
      current_tenant: 'acme-corp',
      halt_patterns: [],
    });
    process.chdir(testDir);

    const drs = new DRSService();
    const result = await drs.check({ tool: 'Write', targetPath: 'workspaces/widgetco/data.json' });

    expect(result.allowed).toBe(false);
    expect(result.ruleFired).toBe(4);
  });
});

describe('DRSService — Rule 2 fail-closed default vs. permissive opt-out', () => {
  it('denies all writes when allowedPaths is empty and permissive is not set', async () => {
    await writeFixtureConfig(testDir, { allowed_paths: [], tenant_namespaces: [], current_tenant: '', halt_patterns: [] });
    process.chdir(testDir);

    const drs = new DRSService();
    const result = await drs.check({ tool: 'Write', targetPath: 'anything.ts' });

    expect(result.allowed).toBe(false);
    expect(result.ruleFired).toBe(2);
  });

  it('allows writes when allowedPaths is empty and permissive: true is set', async () => {
    await writeFixtureConfig(testDir, { allowed_paths: [], tenant_namespaces: [], current_tenant: '', halt_patterns: [], permissive: true });
    process.chdir(testDir);

    const drs = new DRSService();
    const result = await drs.check({ tool: 'Write', targetPath: 'anything.ts' });

    expect(result.allowed).toBe(true);
  });
});

// R3 (Council-1 Condition 4): cwd-relative resolution is a named failure
// mode, not a hypothetical — a caller whose cwd isn't the repo root must
// neither throw nor silently fall back to a permissive shape.
describe('DRSService — R3: resolution diagnostics from a non-standard cwd', () => {
  it('does not throw, does not fall back to a permissive DEFAULT_CONFIG shape, and denies-all with configSource showing the fallback fired', async () => {
    // testDir has no .toto/ at all — deliberately unresolvable.
    process.chdir(testDir);

    expect(() => new DRSService()).not.toThrow();

    const drs = new DRSService();
    expect(drs.configSource).toBe('deny-all-fallback');

    const result = await drs.check({ tool: 'Write', targetPath: 'anything/at/all.ts' });
    expect(result.allowed).toBe(false);
    expect(result.ruleFired).toBe(2);
  });

  it('TOTO_DRS_CONFIG overrides cwd-relative resolution when set, applying the real config instead of deny-all', async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), 'toto-drs-fixture-'));
    try {
      const fixtureConfigPath = join(fixtureDir, 'drs-config.json');
      await writeFile(fixtureConfigPath, JSON.stringify({
        allowed_paths: ['allowed/'],
        tenant_namespaces: [],
        current_tenant: '',
        halt_patterns: [],
      }), 'utf8');

      process.env['TOTO_DRS_CONFIG'] = fixtureConfigPath;
      process.chdir(testDir); // cwd itself still has no .toto/ — env var must win

      const drs = new DRSService();
      expect(drs.configSource).toBe('env:TOTO_DRS_CONFIG');

      const inScope = await drs.check({ tool: 'Write', targetPath: 'allowed/file.ts' });
      expect(inScope.allowed).toBe(true);

      const outOfScope = await drs.check({ tool: 'Write', targetPath: 'elsewhere/file.ts' });
      expect(outOfScope.allowed).toBe(false);
      expect(outOfScope.ruleFired).toBe(2);
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }
  });
});

// Stage 5 (R1 v3, keep-and-harden): checkOverride() bypasses Rules 2/3/4
// only — Rule 1's curated freeze list and Rule 5's own narrower
// --force-confirmed override are both exempt from the message-based bypass.
describe('DRSService — Stage 5: override anchoring (Rules 1/5 exempt, 2/3/4 bypassable)', () => {
  it('does NOT bypass Rule 1 via message_before override', async () => {
    await writeFixtureFreeze(testDir, ['secrets/keys.json']);
    await writeFixtureConfig(testDir, { allowed_paths: ['secrets/'], tenant_namespaces: [], current_tenant: '', halt_patterns: [] });
    process.chdir(testDir);

    const drs = new DRSService();
    const result = await drs.check({
      tool: 'Write',
      targetPath: 'secrets/keys.json',
      messageBefore: 'override drs: emergency fix',
    });

    expect(result.allowed).toBe(false);
    expect(result.ruleFired).toBe(1);
    expect(result.override).toBeUndefined();
  });

  it('does NOT bypass Rule 5 via message_before override', async () => {
    await writeFixtureConfig(testDir, { allowed_paths: [], tenant_namespaces: [], current_tenant: '', halt_patterns: [] });
    process.chdir(testDir);

    const drs = new DRSService();
    const result = await drs.check({
      tool: 'Bash',
      command: 'rm -rf /tmp/foo',
      messageBefore: 'override drs: cleanup',
    });

    expect(result.allowed).toBe(false);
    expect(result.ruleFired).toBe(5);
    expect(result.override).toBeUndefined();
  });
});

describe('DRSService — Stage 5: override still bypasses Rules 2/3/4, with an audit trail', () => {
  it('DOES bypass Rule 2 via message_before override, and writes an audit record', async () => {
    const vaultDir = await mkdtemp(join(tmpdir(), 'toto-drs-vault-'));
    try {
      await writeFixtureConfig(testDir, { allowed_paths: ['src/'], tenant_namespaces: [], current_tenant: '', halt_patterns: [] });
      process.chdir(testDir);

      const vault = new VaultService(vaultDir);
      const drs = new DRSService(undefined, vault);
      const result = await drs.check({
        tool: 'Write',
        targetPath: 'outside/file.ts',
        messageBefore: 'override drs: one-off exception',
      });

      expect(result.allowed).toBe(true);
      expect(result.override).toBe(true);
      expect(result.overrideReason).toBe('one-off exception');

      const drsDir = join(vaultDir, 'DRS');
      const files = await readdir(drsDir);
      expect(files).toHaveLength(1);
      const record = files[0];
      expect(record).toBeDefined();
      const content = await readFile(join(drsDir, record as string), 'utf8');
      expect(content).toContain('override: true');
      expect(content).toContain('one-off exception');
    } finally {
      await rm(vaultDir, { recursive: true, force: true });
    }
  });
});

// Stage 5 part (b)/(a) continued: audit-trail choke-point coverage and the
// Rule-5-before-Rule-3 precedence pin (round-3 non-blocking note).
describe('DRSService — Stage 5: audit-trail choke point and rule precedence', () => {
  it('writes an audit record via the execute()/HookSystem path too — check() is the choke point, not the MCP handler', async () => {
    const vaultDir = await mkdtemp(join(tmpdir(), 'toto-drs-vault-'));
    try {
      await writeFixtureConfig(testDir, { allowed_paths: ['src/'], tenant_namespaces: [], current_tenant: '', halt_patterns: [] });
      process.chdir(testDir);

      const vault = new VaultService(vaultDir);
      const hooks = new HookSystem();
      const hookConfig: HookSystemConfig = {
        hooks: [{ id: 'drs', name: 'Drag Reduction System', priority: 10, enabled: true }],
        maxChainLength: 5,
      };
      hooks.loadConfig(hookConfig, vault);

      const context: HookContext = {
        tool: 'Write',
        input: { targetPath: 'outside/file.ts' },
        metadata: { messageBefore: 'override drs: via hook system' },
        timestamp: Date.now(),
      };
      const result = await hooks.execute(context);

      // Note: HookSystem.execute()'s own aggregation loop discards
      // override/overrideReason on the allowed path (a separate, pre-existing
      // bug outside this plan's scope — see Karpathy record) — so only
      // `allowed` is asserted here. The audit write below is DRSService's own
      // side effect inside check(), unaffected by that aggregation bug, and
      // is the actual thing Stage 5 requires this test to prove.
      expect(result.allowed).toBe(true);

      const drsDir = join(vaultDir, 'DRS');
      const files = await readdir(drsDir);
      expect(files).toHaveLength(1);
    } finally {
      await rm(vaultDir, { recursive: true, force: true });
    }
  });

  it('pins Rule 5 precedence over Rule 3 for a non-override Bash command matching both patterns', async () => {
    await writeFixtureConfig(testDir, { allowed_paths: [], tenant_namespaces: [], current_tenant: '', halt_patterns: [] });
    process.chdir(testDir);

    const drs = new DRSService();
    // "chmod" matches Rule 3's shell-permission-command check; "rm -rf" matches Rule 5.
    // Rule 5 now runs before Rule 3 (both run before checkOverride) — this is
    // the intentional, plan-acknowledged precedence change from Stage 5's (a).
    const result = await drs.check({ tool: 'Bash', command: 'chmod 777 /tmp && rm -rf /tmp/x' });

    expect(result.allowed).toBe(false);
    expect(result.ruleFired).toBe(5);
  });
});
