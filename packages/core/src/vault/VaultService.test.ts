import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { VaultService } from './VaultService.js';

describe('VaultService.search() searchCommand override (regression)', () => {
  let tmpDir: string;
  let fakeCommandPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(os.tmpdir(), 'toto-wolff-vaultservice-test-'));
    // A fake "rg" that ignores its arguments and always reports one fixed
    // match. Real ripgrep would never produce this output, so seeing it in
    // the result proves searchCommand's configured executable actually ran
    // — not that the code silently fell back to real rg or in-memory search.
    fakeCommandPath = join(tmpDir, 'fake-search-command.js');
    writeFileSync(
      fakeCommandPath,
      [
        '#!/usr/bin/env node',
        "console.log(JSON.stringify({ type: 'match', data: { path: { text: 'SENTINEL_FILE' }, line_number: 42, lines: { text: 'sentinel content' } } }));",
      ].join('\n'),
    );
    chmodSync(fakeCommandPath, 0o755);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('executes the configured searchCommand instead of real rg or the in-memory fallback', async () => {
    const vault = await VaultService.create({
      backend: 'file',
      options: { rootPath: tmpDir },
      searchCommand: fakeCommandPath,
    });

    const results = await vault.search('anything');

    expect(results).toEqual([{ file: 'SENTINEL_FILE', line: 42, text: 'sentinel content' }]);
  });
});
