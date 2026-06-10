import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VaultService } from './VaultService.js';

const created: string[] = [];

afterEach(async () => {
  // LOOP BOUND: one temp dir per test, bounded by test count
  while (created.length > 0) {
    const dir = created.pop();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  }
});

describe('VaultService git tolerance', () => {
  it('drainQueue does not throw when the vault has no .git', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'toto-vault-'));
    created.push(dir);
    const vault = new VaultService(dir);

    await vault.write('P10-Plans/test.md', 'blocked plan body');

    // commit is skipped (no .git) but must not throw
    await expect(vault.drainQueue()).resolves.toBeUndefined();
    // the write itself persisted regardless of the commit
    await expect(access(join(dir, 'P10-Plans/test.md'))).resolves.toBeUndefined();
  });
});
