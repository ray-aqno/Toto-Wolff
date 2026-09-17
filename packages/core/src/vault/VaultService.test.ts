import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { VaultService } from './VaultService.js';

const execFileAsync = promisify(execFile);

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

describe('VaultService shared-backend lifecycle (regression)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(os.tmpdir(), 'toto-wolff-vaultservice-shared-test-'));
    await execFileAsync('git', ['init'], { cwd: tmpDir });
    await execFileAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: tmpDir });
    await execFileAsync('git', ['config', 'user.name', 'test'], { cwd: tmpDir });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('a shared backend queue survives one owning service closing, so another can still drain it', async () => {
    // Same backend id + options -> VaultFactory hands both services the
    // same underlying FileStorage instance (and its one commit queue).
    const serviceA = await VaultService.create({ backend: 'file', options: { rootPath: tmpDir } });
    const serviceB = await VaultService.create({ backend: 'file', options: { rootPath: tmpDir } });

    await serviceA.write('shared.md', 'from A, pending commit');
    await serviceA.close();

    // If closing A had cleared the shared backend's queue, this would be a
    // silent no-op and shared.md would never actually get committed.
    await serviceB.drainQueue();

    const { stdout } = await execFileAsync('git', ['log', '--name-only', '--format='], { cwd: tmpDir });
    expect(stdout).toContain('shared.md');
  });
});
