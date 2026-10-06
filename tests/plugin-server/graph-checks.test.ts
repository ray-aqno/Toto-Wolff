// Evidence checks for idea-to-pr (#63): slugs, document numbering, DOC_EXISTS,
// symlinks and size, whole-line headings, path normalisation, PR URLs.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_DOC_BYTES, checkDoc, checkPrUrl, ideaSlug, nextDocPath } from '../../plugin/server/graph/checks.mts';
import { templateFor } from '../../plugin/server/graph/templates.mts';

let project: string;
const IDEA = 'Faster builds\nmore detail';

function put(rel: string, content: string): void {
  mkdirSync(join(project, rel, '..'), { recursive: true });
  writeFileSync(join(project, rel), content);
}

async function rejects(p: Promise<unknown>, code: string, message: string | RegExp): Promise<void> {
  await expect(p).rejects.toMatchObject({ code, message: typeof message === 'string' ? expect.stringContaining(message) as unknown : expect.stringMatching(message) as unknown });
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'toto-checks-'));
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

describe('ideaSlug (Arbiter condition 2, Safety Car S5)', () => {
  it.each([
    ['Faster builds\nmore', 'faster-builds'],
    ['  --Hello, World!-- ', 'hello-world'],
    [`${'a'.repeat(49)} b`, 'a'.repeat(49)],
    ['Café au lait', 'caf-au-lait'],
  ])('%j -> %j', (idea, slug) => {
    expect(ideaSlug(idea)).toBe(slug);
  });

  it('gives non-ASCII or blank first lines a hash slug, different per idea', () => {
    const a = ideaSlug('日本語のアイデア');
    const b = ideaSlug('别的想法');
    expect(a).toMatch(/^idea-[0-9a-f]{6}$/);
    expect(b).toMatch(/^idea-[0-9a-f]{6}$/);
    expect(a).not.toBe(b);
    expect(ideaSlug('\nsecond line only')).toMatch(/^idea-[0-9a-f]{6}$/);
  });
});

describe('nextDocPath', () => {
  it('starts at 0001 in a project with no docs folder (Safety Car S2)', async () => {
    expect(await nextDocPath(project, 'adr', 'faster-builds')).toBe('docs/adr/0001-faster-builds.md');
  });

  it('takes the next number after the highest, ignoring other files', async () => {
    put('docs/adr/0003-other.md', 'x');
    put('docs/adr/.gitkeep', '');
    put('docs/adr/notes.md', 'x');
    expect(await nextDocPath(project, 'adr', 'faster-builds')).toBe('docs/adr/0004-faster-builds.md');
  });

  it('raises DOC_EXISTS for the same slug under any number, case-insensitively, naming the file (S3, S9)', async () => {
    put('docs/rfc/0002-Faster-Builds.md', 'x');
    await rejects(nextDocPath(project, 'rfc', 'faster-builds'), 'DOC_EXISTS', 'docs/rfc/0002-Faster-Builds.md already covers this idea');
  });

  it('matches the slug exactly, not as a prefix (Arbiter condition 3)', async () => {
    put('docs/adr/0001-faster-builds-v2.md', 'x');
    expect(await nextDocPath(project, 'adr', 'faster-builds')).toBe('docs/adr/0002-faster-builds.md');
  });

  it('refuses a full number range and an oversized folder', async () => {
    put('docs/adr/9998-x.md', 'x');
    await rejects(nextDocPath(project, 'adr', 'y'), 'BAD_EVIDENCE', 'already uses number 9998');
    rmSync(join(project, 'docs'), { recursive: true });
    for (let i = 0; i < 1001; i++) put(`docs/adr/f${String(i)}.txt`, '');
    await rejects(nextDocPath(project, 'adr', 'y'), 'BAD_EVIDENCE', 'the limit is 1000');
  });

  it('refuses a symlinked docs folder and a docs file (Arbiter condition 4)', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'toto-checks-elsewhere-'));
    try {
      symlinkSync(elsewhere, join(project, 'docs'));
      await rejects(nextDocPath(project, 'adr', 'y'), 'BAD_EVIDENCE', 'symlinked docs folders are not supported');
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
    rmSync(join(project, 'docs'));
    writeFileSync(join(project, 'docs'), 'a file');
    await rejects(nextDocPath(project, 'adr', 'y'), 'BAD_EVIDENCE', 'is not a folder');
  });
});

describe('checkDoc', () => {
  const ADR = templateFor('adr');

  it('accepts the template at the expected path, with CRLF line ends too', async () => {
    put('docs/adr/0001-faster-builds.md', ADR.replace(/\n/g, '\r\n'));
    await expect(checkDoc(project, 'adr', IDEA, 'docs/adr/0001-faster-builds.md')).resolves.toBeUndefined();
  });

  it.each([
    ['backslashes', 'docs\\adr\\0001-faster-builds.md'],
    ['an absolute path', null],
    ['a ./ prefix', './docs/adr/0001-faster-builds.md'],
  ])('normalises %s (Safety Car S4)', async (_name, artifact) => {
    put('docs/adr/0001-faster-builds.md', ADR);
    await expect(checkDoc(project, 'adr', IDEA, artifact ?? join(project, 'docs/adr/0001-faster-builds.md'))).resolves.toBeUndefined();
  });

  it('names the expected path for a wrong number, a wrong folder, or none', async () => {
    put('docs/adr/0003-other.md', ADR);
    put('docs/adr/0001-faster-builds.md', ADR);
    await rejects(checkDoc(project, 'adr', IDEA, 'docs/adr/0001-faster-builds.md'), 'BAD_EVIDENCE', 'artifacts[0] must be docs/adr/0004-faster-builds.md, not docs/adr/0001-faster-builds.md');
    rmSync(join(project, 'docs', 'adr', '0001-faster-builds.md'));
    await rejects(checkDoc(project, 'adr', IDEA, undefined), 'BAD_EVIDENCE', 'artifacts[0] must be docs/adr/0004-faster-builds.md');
    await rejects(checkDoc(project, 'adr', IDEA, 'docs/rfc/0004-faster-builds.md'), 'BAD_EVIDENCE', 'must be docs/adr/0004-faster-builds.md');
  });

  it('reports DOC_EXISTS, naming the file, when the claimed path differs from an existing doc for the idea', async () => {
    put('docs/adr/0001-faster-builds.md', ADR);
    await rejects(checkDoc(project, 'adr', IDEA, 'docs/adr/0002-faster-builds.md'), 'DOC_EXISTS', 'docs/adr/0001-faster-builds.md already covers this idea');
  });

  it('refuses a missing file', async () => {
    await rejects(checkDoc(project, 'adr', IDEA, 'docs/adr/0001-faster-builds.md'), 'BAD_EVIDENCE', 'cannot be read (ENOENT)');
  });

  it('matches headings as whole lines: "### Status" is not "## Status" (Arbiter condition 5)', async () => {
    put('docs/adr/0001-faster-builds.md', ADR.replace('## Status', '### Status'));
    await rejects(checkDoc(project, 'adr', IDEA, 'docs/adr/0001-faster-builds.md'), 'BAD_EVIDENCE', 'missing the template headings: ## Status');
  });

  it('refuses a symlinked document and an oversized one', async () => {
    put('real.md', ADR);
    mkdirSync(join(project, 'docs', 'adr'), { recursive: true });
    symlinkSync(join(project, 'real.md'), join(project, 'docs', 'adr', '0001-faster-builds.md'));
    await rejects(checkDoc(project, 'adr', IDEA, 'docs/adr/0001-faster-builds.md'), 'BAD_EVIDENCE', 'must be a regular file');
    rmSync(join(project, 'docs', 'adr', '0001-faster-builds.md'));
    put('docs/adr/0001-faster-builds.md', `${ADR}${'x'.repeat(MAX_DOC_BYTES)}`);
    await rejects(checkDoc(project, 'adr', IDEA, 'docs/adr/0001-faster-builds.md'), 'BAD_EVIDENCE', /bytes; the limit is 262144/);
  });

  it('raises DOC_EXISTS when another file already covers the idea', async () => {
    put('docs/adr/0001-faster-builds.md', ADR);
    put('docs/adr/0002-faster-builds.md', ADR);
    await rejects(checkDoc(project, 'adr', IDEA, 'docs/adr/0002-faster-builds.md'), 'DOC_EXISTS', '0001-faster-builds.md already covers this idea');
  });
});

describe('checkPrUrl', () => {
  it('accepts a bare pull request URL (surrounding whitespace allowed)', () => {
    expect(() => { checkPrUrl('https://github.com/ray-aqno/Toto-Wolff/pull/71\n'); }).not.toThrow();
  });

  it.each([['opened https://github.com/a/b/pull/1'], ['https://github.com/a/b/issues/1'], ['http://github.com/a/b/pull/1'], ['https://gitlab.com/a/b/pull/1'], ['https://github.com/a/b/pull/1/files']])('refuses %j', (evidence) => {
    expect(() => { checkPrUrl(evidence); }).toThrow(expect.objectContaining({ code: 'BAD_EVIDENCE' }) as Error);
  });
});
