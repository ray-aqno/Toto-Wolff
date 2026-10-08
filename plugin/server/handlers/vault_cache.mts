// The one V2 vault the dashboard page and SignalIndex share. A server process
// serves exactly one vault path, so the cache holds one promise; a different
// path is a programming error and fails loudly instead of being ignored.
import assert from 'node:assert/strict';
import { VaultService as VaultServiceV2 } from '../core/vault/VaultService.mts';

let cachedPath: string | null = null;
let vaultPromise: Promise<VaultServiceV2> | null = null;

/**
 * Lazily construct (and memoize) the V2 vault facade for this vaultPath.
 * On construction failure the memo is cleared so the next call retries:
 * a transient init error must not permanently wedge every future request.
 */
export function getCachedVault(vaultPath: string): Promise<VaultServiceV2> {
  assert.ok(vaultPath.length > 0, 'vaultPath must be non-empty');
  assert.ok(cachedPath === null || cachedPath === vaultPath, 'one server process serves one vault path');
  if (vaultPromise === null) {
    cachedPath = vaultPath;
    vaultPromise = VaultServiceV2.create({ backend: 'file', options: { rootPath: vaultPath } }).catch((err: unknown) => {
      vaultPromise = null;
      throw err;
    });
  }
  return vaultPromise;
}
