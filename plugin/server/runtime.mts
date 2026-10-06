// What the tools share for the life of one server process: the vault path,
// the vault itself (created on first use), DRS (created on first drs_check,
// so a missing DRS config warns only when DRS is used) and the subagent list.
import assert from 'node:assert/strict';
import process from 'node:process';
import { isAbsolute, join } from 'node:path';
import { DRSService } from './core/DRSService.mts';
import type { AuditVault } from './core/DRSService.mts';
import { SubagentService } from './core/SubagentService.mts';
import type { VaultService } from './core/vault/VaultService.mts';
import { getCachedVault } from './handlers/vault_cache.mts';
import { resolveProjectDir } from './graph/store.mts';

export interface Runtime {
  readonly vaultPath: string;
  vault(): Promise<VaultService>;
  drs(): DRSService;
  readonly subagents: SubagentService;
  // The project the graph tools keep runs in, resolved on each call so the
  // other tools never depend on it (Arbiter condition 8).
  projectDir(): string;
}

// The server's settings come from its arguments, which plugin.json fills from
// the plugin's userConfig and ${CLAUDE_PROJECT_DIR}; it reads nothing from the
// user's environment.
export type ServerConfig = Partial<Record<'vault' | 'project' | 'port', string>>;
const FLAGS: Readonly<Record<string, keyof ServerConfig>> = { '--vault': 'vault', '--project': 'project', '--port': 'port' };
const MAX_ARGS = 16;

/** The settings in `argv`; an empty, unsubstituted or "0" (no dashboard) value is left out. */
export function configFromArgs(argv: readonly string[]): ServerConfig {
  if (argv.length > MAX_ARGS) throw new Error(`at most ${String(MAX_ARGS)} arguments`);
  const config: ServerConfig = {};
  // LOOP BOUND: at most MAX_ARGS / 2 flag and value pairs.
  for (let i = 0; i < argv.length; i += 2) {
    const name = FLAGS[argv[i] ?? ''];
    const value = argv[i + 1];
    if (name === undefined || value === undefined) throw new Error(`unknown argument: ${(argv[i] ?? '').slice(0, 40)}`);
    if (value === '' || value.includes('${') || (name === 'port' && value === '0')) continue;
    config[name] = value;
  }
  assert.ok(Object.keys(config).length <= 3, 'at most the three settings');
  return config;
}

/** The configured vault folder (userConfig vault_path); it must be absolute. */
export function resolveVaultPath(env: ServerConfig): string {
  const vaultPath = env['vault'];
  if (vaultPath === undefined) throw new Error('no vault folder: set it in /plugin > toto-wolff > Configure (Vault folder)');
  assert.ok(isAbsolute(vaultPath), 'the vault folder must be an absolute path');
  assert.ok(vaultPath.length > 1, 'the vault path is not the filesystem root');
  return vaultPath;
}

/**
 * Commits queued writes when the vault is a git repository. Best effort: any
 * failure is one stderr warning and never fails the write that queued it
 * (the file is already on disk).
 */
export async function drainQuietly(vault: VaultService): Promise<void> {
  assert.ok(typeof vault.drainQueue === 'function', 'the vault can drain its queue');
  try {
    await vault.drainQueue();
  } catch (err) {
    const kind = err instanceof Error ? err.name : typeof err;
    process.stderr.write(`toto-wolff: vault commit skipped (${kind})\n`);
  }
}

export function createRuntime(env: ServerConfig): Runtime {
  const vaultPath = resolveVaultPath(env);
  const vault = (): Promise<VaultService> => getCachedVault(vaultPath);
  // DRS override audit records: a rejected write reaches DRSService (the
  // override is then refused); only the commit after it is best effort.
  const auditVault: AuditVault = {
    async write(relPath: string, content: string): Promise<unknown> {
      const v = await vault();
      const result = await v.write(relPath, content);
      await drainQuietly(v);
      return result;
    },
  };
  let drs: DRSService | null = null;
  const runtime: Runtime = {
    vaultPath,
    vault,
    // DRS reads the project's .toto/drs-config.json.
    drs: () => (drs ??= new DRSService(join(resolveProjectDir(env, process.cwd()), '.toto', 'drs-config.json'), auditVault)),
    subagents: new SubagentService(),
    projectDir: () => resolveProjectDir(env, process.cwd()),
  };
  assert.ok(isAbsolute(runtime.vaultPath), 'the runtime holds an absolute vault path');
  return runtime;
}
