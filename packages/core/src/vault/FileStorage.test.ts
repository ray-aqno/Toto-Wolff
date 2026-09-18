import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FileStorage } from './FileStorage.js';

const execFileAsync = promisify(execFile);

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(os.tmpdir(), 'toto-wolff-filestorage-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('FileStorage.write() queue capacity (regression)', () => {
  it('rejects a write without touching disk once the queue is full', async () => {
    const storage = new FileStorage({ id: 'file', name: 'file', options: { rootPath: tmpDir, queueMaxSize: 1 } });
    await storage.initialize();

    await storage.write('a.md', 'first');
    // Queue is now at capacity — this write must be rejected before the
    // file is touched, not after (a full-queue rejection must never leave
    // vault data changed with no record of that change ever queued).
    await expect(storage.write('b.md', 'second')).rejects.toThrow('queue full');
    expect(existsSync(join(tmpDir, 'b.md'))).toBe(false);
  });
});

describe('FileStorage.write() queue deduplication (regression)', () => {
  it('does not wedge the commit queue on repeated writes to the same path', async () => {
    await execFileAsync('git', ['init'], { cwd: tmpDir });
    await execFileAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: tmpDir });
    await execFileAsync('git', ['config', 'user.name', 'test'], { cwd: tmpDir });

    const storage = new FileStorage({ id: 'file', name: 'file', options: { rootPath: tmpDir } });
    await storage.initialize();

    await storage.write('a.md', 'v1');
    await storage.write('a.md', 'v2'); // same path again, before any commit
    await storage.write('b.md', 'other');

    const result = await storage.commit('vault:');
    expect(result.committed).toBe(true);
    expect(readFileSync(join(tmpDir, 'a.md'), 'utf8')).toBe('v2');

    // A commit with nothing left queued must be a clean no-op — proves the
    // queue actually drained rather than getting stuck retrying a no-op
    // "second write to a.md" entry forever.
    const second = await storage.commit('vault:');
    expect(second.committed).toBe(true);
  });
});

describe('FileStorage.listDirAll() vs listDir() cap (regression)', () => {
  it('returns every file in a directory larger than the listDir() cap', async () => {
    const storage = new FileStorage({ id: 'file', name: 'file', options: { rootPath: tmpDir } });
    await storage.initialize();

    const fileCount = 1005; // deliberately > listDir()'s 1000-entry cap
    for (let i = 0; i < fileCount; i++) {
      writeFileSync(join(tmpDir, `record-${String(i).padStart(4, '0')}.md`), 'x');
    }

    const capped = await storage.listDir('.');
    const all = await storage.listDirAll('.');

    expect(capped.length).toBe(1000);
    expect(all.length).toBe(fileCount);
  });
});
