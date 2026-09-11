#!/usr/bin/env node
/**
 * Config Migration Script — migrates old .toto/config.yml format to new format.
 * Idempotent, reversible, dry-run by default.
 */

import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

const __dirname = join(fileURLToPath(import.meta.url), '..');
const REPO_ROOT = join(__dirname, '..');
const CONFIG_PATH = join(REPO_ROOT, '.toto', 'config.yml');

export interface MigrationResult {
  success: boolean;
  changes: string[];
  backupPath?: string;
  error?: string;
}

/**
 * Migrate the legacy local config while defaulting to a non-destructive dry run.
 * Returns a structured result so callers can report changes and failures consistently.
 */
export function migrateConfig(dryRun = true): MigrationResult {
  const changes: string[] = [];

  if (!existsSync(CONFIG_PATH)) {
    return { success: false, changes, error: `Config not found: ${CONFIG_PATH}` };
  }

  const content = readFileSync(CONFIG_PATH, 'utf-8');
  const config = yaml.load(content) as Record<string, unknown>;

  // Check if already migrated
  if (config.provider || config.vault || config.hooks) {
    return { success: true, changes: ['Already migrated — provider, vault, hooks sections present'] };
  }

  // Create backup
  const backupPath = `${CONFIG_PATH}.backup.${Date.now()}`;
  if (!dryRun) {
    writeFileSync(backupPath, content, 'utf-8');
    changes.push(`Created backup: ${backupPath}`);
  } else {
    changes.push(`Would create backup: ${backupPath}`);
  }

  // Add provider section
  config.provider = {
    default: 'anthropic',
    providers: [
      {
        id: 'anthropic',
        name: 'Anthropic',
        models: [
          'claude-opus-4-8',
          'claude-sonnet-4-6',
          'claude-haiku-4-5-20251001',
          'claude-opus-4-0',
          'claude-sonnet-4-0',
          'claude-3-5-sonnet-20241022',
          'claude-3-5-haiku-20241022',
          'claude-3-opus-20240229',
        ],
        timeoutMs: 60000,
        maxRetries: 3,
      },
    ],
  };
  changes.push('Added provider section');

  // Add vault section
  config.vault = {
    backend: 'file',
    options: {
      rootPath: config.vault_path ?? '~/.toto/vault',
      queueMaxSize: 100,
    },
  };
  changes.push('Added vault section');

  // Add hooks section
  config.hooks = {
    maxChainLength: 5,
    hooks: [
      {
        id: 'drs',
        name: 'Drag Reduction System',
        priority: 10,
        enabled: true,
      },
    ],
  };
  changes.push('Added hooks section');

  // Write new config
  // Full yaml.dump(config, ...) on the mutated, fully-parsed config object —
  // not a static template. The old template was non-derived from the parsed
  // config (only vault_path was interpolated), so it silently destroyed every
  // other user customization on every migration run — the actual dominant
  // blast radius of L1-005/L1-006, not the parser bug alone. Comment loss
  // (e.g. "# === Vault ===" section headers) is an accepted, stated cost,
  // mitigated by the pre-existing backup file above. No hybrid static/dump
  // fallback — that branch would ship the exact bug this fixes.
  const newContent = yaml.dump(config, { lineWidth: -1, noRefs: true });

  if (!dryRun) {
    const tmpPath = `${CONFIG_PATH}.tmp.${process.pid}`;
    try {
      writeFileSync(tmpPath, newContent, 'utf-8');
      renameSync(tmpPath, CONFIG_PATH);
      changes.push('Wrote new config');
    } catch (err) {
      return {
        success: false,
        changes,
        error: `Failed to write config: ${err instanceof Error ? err.message : String(err)}`,
        backupPath,
      };
    }
  } else {
    changes.push('Would write new config (dry-run)');
  }

  return { success: true, changes, ...(dryRun ? {} : { backupPath }) };
}

// CLI — guarded so importing migrateConfig() (e.g. from a test) does not
// also run it for real against the live .toto/config.yml as a side effect.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');

  console.log(`Config Migration ${dryRun ? '(dry-run)' : '(apply)'}`);
  console.log('='.repeat(50));

  const result = migrateConfig(dryRun);

  if (result.success) {
    console.log('\nChanges:');
    for (const change of result.changes) {
      console.log(`  ✓ ${change}`);
    }
    if (result.backupPath) {
      console.log(`\nBackup: ${result.backupPath}`);
    }
    if (dryRun) {
      console.log('\nRun with --apply to apply changes.');
    }
  } else {
    console.error(`\nError: ${result.error}`);
    process.exit(1);
  }
}