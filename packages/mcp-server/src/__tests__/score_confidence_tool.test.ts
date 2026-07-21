import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleScoreConfidence } from '../handlers/score_confidence_tool.js';

/** Writes a valid SignalRecord .md (frontmatter only) into VAULT/Signals/. */
async function seedSignal(
  vaultDir: string,
  id: string,
  topicTags: string[],
  validUntil = '2027-12-31',
): Promise<void> {
  const signalsDir = join(vaultDir, 'Signals');
  await mkdir(signalsDir, { recursive: true });
  const fm = [
    '---',
    `id: ${id}`,
    `content_hash: hash-${id}`,
    `valid_until: ${validUntil}`,
    'verdict: approved',
    'pattern: architectural-decision-record',
    `topic_tags: ${JSON.stringify(topicTags)}`,
    '---',
    '',
  ].join('\n');
  await writeFile(join(signalsDir, `${id}.md`), fm, 'utf8');
}

describe('handleScoreConfidence', () => {
  it('returns LOW with cold-start disqualifier when Signals/ is absent', async () => {
    const vaultDir = await mkdtemp(join(tmpdir(), 'toto-sc-'));
    try {
      const result = await handleScoreConfidence({ ruling: 'anything' }, vaultDir);
      expect(result.tier).toBe('LOW');
      expect(result.matchCount).toBe(0);
      expect(result.disqualifiers).toHaveLength(1);
      expect(result.disqualifiers[0]).toContain('toto backfill');
    } finally {
      await rm(vaultDir, { recursive: true, force: true });
    }
  });

  it('returns cold-start (not a matching error) when the only records are expired', async () => {
    const vaultDir = await mkdtemp(join(tmpdir(), 'toto-sc-'));
    try {
      await seedSignal(vaultDir, 'adr-001', ['auth', 'service-boundary'], '2000-01-01');
      await seedSignal(vaultDir, 'adr-002', ['auth', 'service-boundary'], '2000-01-01');
      const result = await handleScoreConfidence(
        { ruling: 'Should the auth service own the service-boundary token?' },
        vaultDir,
      );
      expect(result.tier).toBe('LOW');
      expect(result.matchCount).toBe(0);
      expect(result.disqualifiers[0]).toContain('toto backfill');
    } finally {
      await rm(vaultDir, { recursive: true, force: true });
    }
  });

  it('returns HIGH for two relevant, coherent records matched by the ruling', async () => {
    const vaultDir = await mkdtemp(join(tmpdir(), 'toto-sc-'));
    try {
      await seedSignal(vaultDir, 'adr-001', ['auth', 'service-boundary']);
      await seedSignal(vaultDir, 'adr-002', ['auth', 'service-boundary']);
      const result = await handleScoreConfidence(
        { ruling: 'Should the auth service own the service-boundary token?' },
        vaultDir,
      );
      expect(result.tier).toBe('HIGH');
      expect(result.matchCount).toBe(2);
      expect(result.disqualifiers).toHaveLength(0);
    } finally {
      await rm(vaultDir, { recursive: true, force: true });
    }
  });

  it('matches tags on word boundaries, not as substrings of larger words', async () => {
    const vaultDir = await mkdtemp(join(tmpdir(), 'toto-sc-'));
    try {
      // Both tags appear ONLY as substrings of larger words in the ruling:
      // "cat" in "concatenation", "auth" in "reauthorization". A substring match
      // would select both records and wrongly score HIGH; whole-word matching
      // must select neither.
      await seedSignal(vaultDir, 'adr-001', ['cat', 'auth']);
      await seedSignal(vaultDir, 'adr-002', ['cat', 'auth']);
      const result = await handleScoreConfidence(
        { ruling: 'Improve concatenation during reauthorization.' },
        vaultDir,
      );
      expect(result.tier).toBe('LOW');
      expect(result.matchCount).toBe(0);
    } finally {
      await rm(vaultDir, { recursive: true, force: true });
    }
  });

  it('returns LOW when the ruling matches no record tags', async () => {
    const vaultDir = await mkdtemp(join(tmpdir(), 'toto-sc-'));
    try {
      await seedSignal(vaultDir, 'adr-001', ['auth', 'service-boundary']);
      await seedSignal(vaultDir, 'adr-002', ['auth', 'service-boundary']);
      const result = await handleScoreConfidence(
        { ruling: 'A ruling about database indexing strategy' },
        vaultDir,
      );
      expect(result.tier).toBe('LOW');
      expect(result.matchCount).toBe(0);
    } finally {
      await rm(vaultDir, { recursive: true, force: true });
    }
  });

  it('throws when ruling is missing or empty', async () => {
    const vaultDir = await mkdtemp(join(tmpdir(), 'toto-sc-'));
    try {
      await expect(handleScoreConfidence({}, vaultDir)).rejects.toThrow();
      await expect(handleScoreConfidence({ ruling: '' }, vaultDir)).rejects.toThrow();
    } finally {
      await rm(vaultDir, { recursive: true, force: true });
    }
  });
});
