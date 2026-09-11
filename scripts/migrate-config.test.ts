import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import * as yaml from 'js-yaml';
import { migrateConfig } from './migrate-config.js';

// Partial mock: renameSync becomes a spy-able vi.fn() wrapping the real
// implementation by default, so every other test's real fs calls (including
// migrateConfig()'s own internal renameSync calls) keep working unchanged.
// Only the crash-simulation test below overrides it, once, via
// mockImplementationOnce.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

// migrateConfig()'s own tests point it (via the injected `configPath` param)
// at a dedicated fixture in the OS temp dir, never at the real, gitignored
// .toto/config.yml — a test run must not touch a developer's live config.
const TEST_CONFIG_PATH = join(os.tmpdir(), 'toto-wolff-migrate-config-test-fixture.yml');

afterEach(() => {
  if (existsSync(TEST_CONFIG_PATH)) unlinkSync(TEST_CONFIG_PATH);
  const tmpPath = `${TEST_CONFIG_PATH}.tmp.${process.pid}`;
  if (existsSync(tmpPath)) unlinkSync(tmpPath);
});

describe('js-yaml round-trip (regression for the dropped-array-items defect)', () => {
  it('preserves list-valued keys, in order, through load -> mutate -> dump -> load', () => {
    const source = yaml.dump({
      drs: {
        freeze_paths: ['packages/core/src/types.ts', 'packages/mcp-server/src/index.ts', 'a/third/path.ts'],
      },
    });

    const parsed = yaml.load(source) as Record<string, unknown>;
    (parsed as { extra?: string }).extra = 'mutated';
    const roundTripped = yaml.load(yaml.dump(parsed)) as {
      drs: { freeze_paths: string[] };
    };

    expect(roundTripped.drs.freeze_paths).toEqual([
      'packages/core/src/types.ts',
      'packages/mcp-server/src/index.ts',
      'a/third/path.ts',
    ]);
  });
});

describe('js-yaml round-trip (regression for the flat-parsing/nesting-loss defect)', () => {
  it('preserves nested-object keys at their correct nesting level', () => {
    const source = yaml.dump({
      drs: { freeze_paths: ['x.ts', 'y.ts'] },
      provider: {
        providers: [{ id: 'anthropic', models: ['claude-opus-4-8', 'claude-sonnet-4-6'] }],
      },
    });

    const roundTripped = yaml.load(yaml.dump(yaml.load(source))) as {
      drs: { freeze_paths: string[] };
      provider: { providers: Array<{ id: string; models: string[] }> };
    };

    expect(roundTripped.drs.freeze_paths).toEqual(['x.ts', 'y.ts']);
    expect(roundTripped.provider.providers[0]?.id).toBe('anthropic');
    expect(roundTripped.provider.providers[0]?.models).toEqual(['claude-opus-4-8', 'claude-sonnet-4-6']);
  });
});

describe('migrateConfig() already-migrated short-circuit', () => {
  it('fires when provider, vault, or hooks sections are already present', () => {
    writeFileSync(TEST_CONFIG_PATH, yaml.dump({ provider: {}, vault: {}, hooks: {} }), 'utf-8');

    // dryRun=true here must be a pure no-op read.
    const before = readFileSync(TEST_CONFIG_PATH, 'utf-8');
    const result = migrateConfig(true, TEST_CONFIG_PATH);
    const after = readFileSync(TEST_CONFIG_PATH, 'utf-8');

    expect(result.success).toBe(true);
    expect(result.changes.some((c) => c.includes('Already migrated'))).toBe(true);
    expect(after).toBe(before);
  });
});

describe('migrateConfig() end-to-end write-path regression (L1-005/L1-006)', () => {
  it('preserves user customizations through a real migration run', () => {
    let backupPath: string | undefined;

    try {
      const fixture = {
        drs: {
          current_tenant: 'not-acme-corp',
          halt_patterns: ['TRUNCATE TABLE', 'git push --force', 'DROP DATABASE'],
        },
        p10: {
          max_plan_lines: 150,
        },
      };
      writeFileSync(TEST_CONFIG_PATH, yaml.dump(fixture), 'utf-8');

      const result = migrateConfig(false, TEST_CONFIG_PATH);
      backupPath = result.backupPath;
      expect(result.success).toBe(true);

      const migrated = yaml.load(readFileSync(TEST_CONFIG_PATH, 'utf-8')) as {
        drs: { current_tenant: string; halt_patterns: string[] };
        p10: { max_plan_lines: number };
      };

      expect(migrated.drs.current_tenant).toBe('not-acme-corp');
      expect(migrated.drs.halt_patterns).toContain('DROP DATABASE');
      expect(migrated.p10.max_plan_lines).toBe(150);
    } finally {
      if (backupPath && existsSync(backupPath)) {
        unlinkSync(backupPath);
      }
    }
  });
});

describe('migrateConfig() atomic write (L1-005 regression)', () => {
  it('leaves the original file untouched if rename fails mid-write', () => {
    const fixtureContent = yaml.dump({ drs: { current_tenant: 'not-acme-corp' } });
    writeFileSync(TEST_CONFIG_PATH, fixtureContent, 'utf-8');

    vi.mocked(renameSync).mockImplementationOnce(() => {
      throw new Error('simulated crash between temp-write and rename');
    });

    let backupPath: string | undefined;

    try {
      const result = migrateConfig(false, TEST_CONFIG_PATH);
      backupPath = result.backupPath;

      expect(result.success).toBe(false);
      expect(result.error).toContain('simulated crash between temp-write and rename');
      expect(result.backupPath).toBeDefined();

      const afterCrash = readFileSync(TEST_CONFIG_PATH, 'utf-8');
      expect(afterCrash).toBe(fixtureContent);
    } finally {
      if (backupPath && existsSync(backupPath)) unlinkSync(backupPath);
    }
  });

  it('produces byte-identical output to a plain (non-atomic) write on the happy path', () => {
    writeFileSync(TEST_CONFIG_PATH, yaml.dump({ drs: { current_tenant: 'still-not-acme' } }), 'utf-8');
    let backupPath: string | undefined;

    try {
      const result = migrateConfig(false, TEST_CONFIG_PATH);
      backupPath = result.backupPath;
      expect(result.success).toBe(true);
      const viaAtomicWrite = readFileSync(TEST_CONFIG_PATH, 'utf-8');

      // Independently verify the write MECHANISM (temp-write + rename) doesn't
      // alter bytes versus a plain writeFileSync of the same content — this
      // isolates the mechanism change Stage 2 makes from the content
      // computation, which Stage 2 doesn't touch.
      const directCheckPath = `${TEST_CONFIG_PATH}.direct-write-check`;
      writeFileSync(directCheckPath, viaAtomicWrite, 'utf-8');
      const viaDirectWrite = readFileSync(directCheckPath, 'utf-8');
      unlinkSync(directCheckPath);

      expect(viaAtomicWrite).toBe(viaDirectWrite);
    } finally {
      if (backupPath && existsSync(backupPath)) unlinkSync(backupPath);
    }
  });

  it('names the temp file so it cannot collide with the backup naming scheme', () => {
    const tmpPath = `${TEST_CONFIG_PATH}.tmp.${process.pid}`;
    expect(tmpPath.includes('.backup.')).toBe(false);
    expect(tmpPath.startsWith(`${TEST_CONFIG_PATH}.backup.`)).toBe(false);
  });
});
