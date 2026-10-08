// The built-in vault search (#60): literal matching, absolute paths, the
// three caps (each sets truncated on its own) and the regex note.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_SEARCH_FILE_BYTES,
  MAX_SEARCH_RESULTS,
  MAX_SEARCH_TOTAL_BYTES,
  searchFiles,
} from '../../plugin/server/core/vault/search.mts';
import { handleVaultSearch } from '../../plugin/server/handlers/vault_search.mts';
import type { VaultService } from '../../plugin/server/core/vault/VaultService.mts';

let dir: string;

function put(rel: string, content: string): string {
  const file = join(dir, rel);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, content, 'utf8');
  return file;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'toto-search-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('searchFiles: matching and paths', () => {
  it('matches literal, case-sensitive text and returns absolute paths, line numbers and trimmed text', async () => {
    const file = put('Notes/a.md', 'first\n  has a.b here  \naxb only\nA.B upper\n');
    expect(await searchFiles(dir, 'a.b')).toEqual({ results: [{ file, line: 2, text: 'has a.b here' }], truncated: false });
  });

  it('treats regex metacharacters as text', async () => {
    const file = put('x.md', 'a|b\nab\n');
    expect(await searchFiles(dir, 'a|b')).toEqual({ results: [{ file, line: 1, text: 'a|b' }], truncated: false });
  });

  it('searches files in name order, a directory before its subdirectories', async () => {
    const b = put('b.md', 'hit');
    const a = put('a.md', 'hit');
    const nested = put('a/z.md', 'hit');
    expect((await searchFiles(dir, 'hit')).results.map((r) => r.file)).toEqual([a, b, nested]);
  });

  it('skips entries whose own name starts with a dot (.git, .obsidian, dotfiles)', async () => {
    put('.git/config', 'hit');
    put('.obsidian/workspace.json', 'hit');
    put('Notes/.hidden.md', 'hit');
    const seen = put('Notes/seen.md', 'hit');
    expect((await searchFiles(dir, 'hit')).results.map((r) => r.file)).toEqual([seen]);
  });

  it('still searches a vault whose root sits inside a dot-directory (the default ~/.toto/vault)', async () => {
    const root = join(dir, '.toto', 'vault');
    const file = join(root, 'Notes', 'a.md');
    mkdirSync(join(root, 'Notes'), { recursive: true });
    writeFileSync(file, 'hit\n');
    expect(await searchFiles(root, 'hit')).toEqual({ results: [{ file, line: 1, text: 'hit' }], truncated: false });
  });

  it('keeps the root as given when it is a symbolic link (paths are not resolved)', async () => {
    put('real/a.md', 'hit');
    const link = join(dir, 'link');
    symlinkSync(join(dir, 'real'), link);
    expect((await searchFiles(link, 'hit')).results.map((r) => r.file)).toEqual([join(link, 'a.md')]);
  });

  it('does not follow symbolic links inside the vault', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'toto-search-outside-'));
    try {
      writeFileSync(join(outside, 'secret.md'), 'hit');
      symlinkSync(outside, join(dir, 'linkdir'));
      symlinkSync(join(outside, 'secret.md'), join(dir, 'linkfile.md'));
      expect(await searchFiles(dir, 'hit')).toEqual({ results: [], truncated: false });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('searchFiles: the three caps', () => {
  it(`stops at ${String(MAX_SEARCH_RESULTS)} results and sets truncated`, async () => {
    put('many.md', 'hit\n'.repeat(MAX_SEARCH_RESULTS + 1));
    const out = await searchFiles(dir, 'hit');
    expect(out.results).toHaveLength(MAX_SEARCH_RESULTS);
    expect(out.truncated).toBe(true);
  });

  it('returns exactly the cap without truncated when that is all there is', async () => {
    put('many.md', 'hit\n'.repeat(MAX_SEARCH_RESULTS));
    expect(await searchFiles(dir, 'hit')).toMatchObject({ truncated: false });
  });

  it('skips files over 1 MiB and sets truncated', async () => {
    put('big.md', `hit\n${'x'.repeat(MAX_SEARCH_FILE_BYTES)}`);
    const small = put('small.md', 'hit');
    expect(await searchFiles(dir, 'hit')).toEqual({ results: [{ file: small, line: 1, text: 'hit' }], truncated: true });
  });

  it('keeps the serialized results under 512 KiB and sets truncated', async () => {
    put('wide.md', `${'hit'.padEnd(2000, 'y')}\n`.repeat(400));
    const out = await searchFiles(dir, 'hit');
    expect(out.truncated).toBe(true);
    expect(out.results.length).toBeLessThan(400);
    expect(Buffer.byteLength(JSON.stringify(out.results), 'utf8')).toBeLessThanOrEqual(MAX_SEARCH_TOTAL_BYTES);
  });

  it('never returns one line larger than the budget (a 900 KB minified line)', async () => {
    put('min.js', `hit${'z'.repeat(900_000)}`);
    expect(await searchFiles(dir, 'hit')).toEqual({ results: [], truncated: true });
  });
});

describe('vault_search: output shape and the literal-matching note', () => {
  const vaultOver = (dirPath: string): VaultService =>
    ({ searchBounded: (q: string) => searchFiles(dirPath, q) }) as unknown as VaultService;

  it('returns { results, truncated } with no note when something matched', async () => {
    const file = put('a.md', 'a|b');
    expect(await handleVaultSearch({ query: 'a|b' }, vaultOver(dir))).toEqual({ results: [{ file, line: 1, text: 'a|b' }], truncated: false });
  });

  it('adds the note when nothing matched and the query looks like a regex', async () => {
    put('a.md', 'alpha beta');
    const out = await handleVaultSearch({ query: 'alpha|beta' }, vaultOver(dir));
    expect(out).toMatchObject({ results: [], truncated: false });
    expect(out.note).toContain('literal');
  });

  it('adds no note for a plain query, or when a cap may have hidden a match', async () => {
    put('a.md', 'alpha');
    expect(await handleVaultSearch({ query: 'gamma' }, vaultOver(dir))).toEqual({ results: [], truncated: false });
    put('big.md', 'x'.repeat(MAX_SEARCH_FILE_BYTES + 1));
    expect(await handleVaultSearch({ query: 'g(a)' }, vaultOver(dir))).toEqual({ results: [], truncated: true });
  });

  it.each([[''], ['q'.repeat(501)], [42]])('rejects query %j as invalid input', async (query) => {
    await expect(handleVaultSearch({ query }, vaultOver(dir))).rejects.toMatchObject({ name: 'MCPValidationError' });
  });

  it('accepts a 500-character query', async () => {
    await expect(handleVaultSearch({ query: 'q'.repeat(500) }, vaultOver(dir))).resolves.toMatchObject({ truncated: false });
  });
});
