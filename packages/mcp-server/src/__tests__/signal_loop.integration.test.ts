import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SignalIndex } from '../handlers/signal_index.js';
import { scoreConfidence } from '../handlers/scoreConfidence.js';
import type { SignalRecord } from '@toto-wolff/core';

const VALID_UNTIL = '2027-12-31';
const NOW = '2026-06-25';

/** Writes a signal record fixture file to a Signals/ subdirectory. */
async function writeFixture(signalsDir: string, id: string, tags: string[], pattern = 'architectural-decision-record'): Promise<void> {
  const content = `---
id: "${id}"
content_hash: "abc${id}"
valid_until: "${VALID_UNTIL}"
verdict: "approved"
pattern: "${pattern}"
topic_tags: ${JSON.stringify(tags)}
---

Fixture signal record for integration test.
`;
  await writeFile(join(signalsDir, `${id}.md`), content, 'utf8');
}

describe('signal loop integration', () => {
  let vaultDir: string;
  let signalsDir: string;

  beforeEach(async () => {
    vaultDir = await mkdtemp(join(tmpdir(), 'toto-vault-'));
    signalsDir = join(vaultDir, 'Signals');
    await mkdir(signalsDir);
  });

  afterEach(async () => {
    await rm(vaultDir, { recursive: true, force: true });
  });

  it('loads fixtures and scoreConfidence returns HIGH for two matching records', async () => {
    await writeFixture(signalsDir, 'adr-001', ['auth', 'service-boundary']);
    await writeFixture(signalsDir, 'adr-002', ['auth', 'service-boundary']);

    const idx = new SignalIndex(vaultDir);
    await idx.load();
    const records = idx.getAll();

    expect(records).toHaveLength(2);

    // P10 Rule 5: explicit assertion on record shape before scoring
    expect(records[0]?.topic_tags).toEqual(['auth', 'service-boundary']);
    expect(records[0]?.pattern).toBe('architectural-decision-record');

    const result = scoreConfidence(records as SignalRecord[], NOW);
    expect(result.tier).toBe('HIGH');
    expect(result.matchCount).toBe(2);
    expect(result.disqualifiers).toHaveLength(0);
  });

  it('query() uses exact array membership, not substring match', async () => {
    await writeFixture(signalsDir, 'adr-003', ['auth', 'service-boundary']);

    const idx = new SignalIndex(vaultDir);
    await idx.load();

    // Exact match finds the record
    const exactMatch = idx.query('auth');
    expect(exactMatch).toHaveLength(1);

    // Substring of a tag does NOT match (exact membership, not substring)
    const substringNoMatch = idx.query('aut');
    expect(substringNoMatch).toHaveLength(0);

    // Tag that is not present does not match
    const noMatch = idx.query('database');
    expect(noMatch).toHaveLength(0);
  });

  it('returns LOW for records with mismatched topic_tags', async () => {
    await writeFixture(signalsDir, 'adr-004', ['auth', 'payments']);
    await writeFixture(signalsDir, 'adr-005', ['infra', 'networking']);

    const idx = new SignalIndex(vaultDir);
    await idx.load();
    const records = idx.getAll();

    const result = scoreConfidence(records as SignalRecord[], NOW);
    expect(result.tier).toBe('LOW');
    expect(result.disqualifiers.some((d) => d.includes('Jaccard'))).toBe(true);
  });

  it('empty Signals/ dir produces empty index and LOW score', async () => {
    // Remove Signals/ dir to simulate cold-start ENOENT
    await rm(signalsDir, { recursive: true });

    const idx = new SignalIndex(vaultDir);
    await idx.load();
    expect(idx.getAll()).toHaveLength(0);

    const result = scoreConfidence([], NOW);
    expect(result.tier).toBe('LOW');
    expect(result.disqualifiers[0]).toMatch(/fewer than/);
  });
});
