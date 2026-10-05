// What the tools share for the life of one server process: the vault path,
// the vault itself (created on first use), DRS (created on first drs_check,
// so a missing DRS config warns only when DRS is used) and the subagent list.
import assert from 'node:assert/strict';
import process from 'node:process';
import { isAbsolute } from 'node:path';
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

/** TOTO_VAULT_PATH, else $HOME/.toto/vault; must be absolute (as v1). */
export function resolveVaultPath(env: NodeJS.ProcessEnv): string {
  const vaultPath = env['TOTO_VAULT_PATH'] ?? `${env['HOME'] ?? ''}/.toto/vault`;
  assert.ok(isAbsolute(vaultPath), 'TOTO_VAULT_PATH must be an absolute path');
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

export function createRuntime(env: NodeJS.ProcessEnv): Runtime {
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
    drs: () => (drs ??= new DRSService(undefined, auditVault)),
    subagents: new SubagentService(),
    projectDir: () => resolveProjectDir(env, process.cwd()),
  };
  assert.ok(isAbsolute(runtime.vaultPath), 'the runtime holds an absolute vault path');
  return runtime;
}
