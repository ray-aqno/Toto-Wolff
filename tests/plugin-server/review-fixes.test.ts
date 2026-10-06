// Regressions for the PR #68 review (Greptile): audit records never share a
// name, a failing git never fills the write queue, and the search depth
// limit is reported as truncation.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DRSService } from '../../plugin/server/core/DRSService.mts';
import type { AuditVault } from '../../plugin/server/core/DRSService.mts';
import { FileStorage } from '../../plugin/server/core/vault/FileStorage.mts';
import { searchFiles } from '../../plugin/server/core/vault/search.mts';

let dir: string;
const savedPath = process.env['PATH'];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'toto-review-'));
});

afterEach(() => {
  process.env['PATH'] = savedPath;
  vi.useRealTimers();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('DRS override audit records', () => {
  it('gives two overrides in the same millisecond two records', async () => {
    writeFileSync(join(dir, 'drs.json'), JSON.stringify({ allowed_paths: ['src/'], tenant_namespaces: [], current_tenant: '', halt_patterns: [] }));
    const records = new Map<string, string>();
    const vault: AuditVault = {
      write: (relPath, content) => {
        records.set(relPath, content);
        return Promise.resolve({ path: relPath });
      },
    };
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-05T12:00:00.000Z') });
    const drs = new DRSService(join(dir, 'drs.json'), vault);
    const call = { tool: 'Write', targetPath: 'outside/x.ts', messageBefore: 'override drs: same instant' } as const;
    const results = await Promise.all([drs.check(call), drs.check(call)]);
    expect(results.every((r) => r.allowed && r.override === true)).toBe(true);
    expect(records.size).toBe(2);
  });
});

describe('FileStorage commit with a failing git', () => {
  it('clears the queue when git itself fails, so later writes are never rejected as "queue full"', async () => {
    const fakeBin = join(dir, 'bin');
    mkdirSync(fakeBin);
    writeFileSync(join(fakeBin, 'git'), '#!/bin/sh\nexit 2\n', { mode: 0o755 });
    process.env['PATH'] = `${fakeBin}:${savedPath ?? ''}`;
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const storage = new FileStorage({ id: 'file', name: 'file', options: { rootPath: join(dir, 'vault'), queueMaxSize: 1 } });
    await storage.initialize();
    await storage.write('a.md', 'a');
    expect(await storage.commit('vault:')).toMatchObject({ committed: false });
    await expect(storage.write('b.md', 'b')).resolves.toMatchObject({ success: true });
  });
});

describe('search depth limit', () => {
  it('reports truncated when a directory is deeper than the search descends', async () => {
    const deep = join(dir, ...Array.from({ length: 18 }, (_, i) => `d${String(i)}`));
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, 'deep.md'), 'hit');
    writeFileSync(join(dir, 'top.md'), 'hit');
    const out = await searchFiles(dir, 'hit');
    expect(out.results.map((r) => r.file)).toEqual([join(dir, 'top.md')]);
    expect(out.truncated).toBe(true);
  });
});
