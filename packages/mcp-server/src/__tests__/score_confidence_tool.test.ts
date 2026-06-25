import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleScoreConfidence } from '../handlers/score_confidence_tool.js';

const VALID_RECORD = {
  id: 'adr-001',
  content_hash: 'abc123',
  valid_until: '2027-12-31',
  verdict: 'approved',
  pattern: 'architectural-decision-record',
  topic_tags: ['auth', 'service-boundary'],
};

describe('handleScoreConfidence', () => {
  it('returns LOW with cold-start disqualifier when Signals/ is absent', async () => {
    const vaultDir = await mkdtemp(join(tmpdir(), 'toto-sc-'));
    try {
      const result = await handleScoreConfidence(
        { now: '2026-06-25', records: [] },
        vaultDir,
      );
      expect(result.tier).toBe('LOW');
      expect(result.matchCount).toBe(0);
      expect(result.disqualifiers).toHaveLength(1);
      expect(result.disqualifiers[0]).toContain('toto backfill');
    } finally {
      await rm(vaultDir, { recursive: true, force: true });
    }
  });

  it('delegates to scoreConfidence and returns HIGH for two valid records', async () => {
    const vaultDir = await mkdtemp(join(tmpdir(), 'toto-sc-'));
    try {
      const result = await handleScoreConfidence(
        {
          now: '2026-06-25',
          records: [
            VALID_RECORD,
            { ...VALID_RECORD, id: 'adr-002', topic_tags: ['auth', 'service-boundary'] },
          ],
        },
        vaultDir,
      );
      expect(result.tier).toBe('HIGH');
      expect(result.disqualifiers).toHaveLength(0);
    } finally {
      await rm(vaultDir, { recursive: true, force: true });
    }
  });

  it('throws when records array contains an invalid record shape', async () => {
    const vaultDir = await mkdtemp(join(tmpdir(), 'toto-sc-'));
    try {
      await expect(
        handleScoreConfidence(
          { now: '2026-06-25', records: [{ id: '' }] },
          vaultDir,
        ),
      ).rejects.toThrow();
    } finally {
      await rm(vaultDir, { recursive: true, force: true });
    }
  });
});
