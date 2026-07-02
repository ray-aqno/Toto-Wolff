import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanDirectory, parsePatternRefs, writeSynthesisRecord } from '../commands/synthesize.js';

describe('scanDirectory', () => {
  let vault: string;

  afterEach(async () => {
    if (vault) await rm(vault, { recursive: true, force: true });
  });

  it('returns empty excerpts when the directory does not exist (ENOENT)', async () => {
    vault = await mkdtemp(join(tmpdir(), 'toto-synth-'));

    const scan = await scanDirectory('ADR', vault);

    expect(scan.dir).toBe('ADR');
    expect(scan.files).toEqual([]);
    expect(scan.excerpts).toEqual([]);
  });

  it('reads .md files from an existing directory, capped and skipping unreadable entries', async () => {
    vault = await mkdtemp(join(tmpdir(), 'toto-synth-'));
    await mkdir(join(vault, 'ADR'), { recursive: true });
    await writeFile(join(vault, 'ADR', 'a.md'), '---\nstatus: accepted\n---\nBody A');
    await writeFile(join(vault, 'ADR', 'b.md'), '---\nstatus: blocked\n---\nBody B');
    await writeFile(join(vault, 'ADR', 'ignore.txt'), 'not markdown');

    const scan = await scanDirectory('ADR', vault);

    expect(scan.files).toHaveLength(2);
    expect(scan.excerpts).toHaveLength(2);
    expect(scan.excerpts.some((e) => e.includes('Body A'))).toBe(true);
  });

  it('rejects a dir string that is not a known synthesis directory', async () => {
    vault = await mkdtemp(join(tmpdir(), 'toto-synth-'));
    await expect(scanDirectory('NotARealDir', vault)).rejects.toThrow();
  });
});

describe('parsePatternRefs', () => {
  it('parses well-formed REF lines', () => {
    const text = 'Some analysis prose.\n\nREF: Council/Congressional-Records/2026-07-01-foo.md | Never referenced in a later P10 plan\nREF: ADR/adr-auth.md | Orphaned, no follow-up commit';

    const refs = parsePatternRefs(text);

    expect(refs).toHaveLength(2);
    expect(refs[0]).toEqual({ dir: 'Council', path: 'Congressional-Records/2026-07-01-foo.md', reason: 'Never referenced in a later P10 plan' });
    expect(refs[1]).toEqual({ dir: 'ADR', path: 'adr-auth.md', reason: 'Orphaned, no follow-up commit' });
  });

  it('returns an empty array when the response has no REF block (degraded path)', () => {
    const text = 'No concrete references this time — general prose only.';

    const refs = parsePatternRefs(text);

    expect(refs).toEqual([]);
  });

  it('returns an empty array on malformed REF lines rather than throwing', () => {
    const text = 'REF: missing-reason-and-pipe\nREF: also | broken | too many pipes but should still try\n';

    expect(() => parsePatternRefs(text)).not.toThrow();
  });
});

describe('writeSynthesisRecord', () => {
  let vault: string;

  afterEach(async () => {
    if (vault) await rm(vault, { recursive: true, force: true });
  });

  it('writes a record with pattern_refs: [] and synthesis_status: degraded when refs are empty', async () => {
    vault = await mkdtemp(join(tmpdir(), 'toto-synth-'));

    const outPath = await writeSynthesisRecord({ text: 'Some synthesis prose with no refs.', refs: [], degraded: true }, vault);

    const content = await readFile(outPath, 'utf8');
    expect(content).toContain('synthesis_status: "degraded"');
    expect(content).toContain('pattern_refs:\n[]');
    expect(content).toContain('Some synthesis prose with no refs.');
  });

  it('writes a record with populated pattern_refs and synthesis_status: complete', async () => {
    vault = await mkdtemp(join(tmpdir(), 'toto-synth-'));

    const outPath = await writeSynthesisRecord(
      { text: 'Found a real pattern.', refs: [{ path: 'foo.md', dir: 'ADR', reason: 'orphaned' }], degraded: false },
      vault,
    );

    const content = await readFile(outPath, 'utf8');
    expect(content).toContain('synthesis_status: "complete"');
    expect(content).toContain('path: "foo.md"');
    expect(content).toContain('dir: "ADR"');
  });

  it('creates the Synthesis/ directory if it does not exist', async () => {
    vault = await mkdtemp(join(tmpdir(), 'toto-synth-'));

    const outPath = await writeSynthesisRecord({ text: 'x', refs: [], degraded: true }, vault);

    expect(outPath).toContain('Synthesis');
    const content = await readFile(outPath, 'utf8');
    expect(content.length).toBeGreaterThan(0);
  });

  it('throws if analysis text is empty', async () => {
    vault = await mkdtemp(join(tmpdir(), 'toto-synth-'));
    await expect(writeSynthesisRecord({ text: '', refs: [], degraded: true }, vault)).rejects.toThrow();
  });
});
