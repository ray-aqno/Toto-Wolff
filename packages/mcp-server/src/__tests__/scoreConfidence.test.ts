import { describe, it, expect } from 'vitest';
import { scoreConfidence } from '../handlers/scoreConfidence.js';
import type { SignalRecord } from '@toto-wolff/core';

const NOW = '2027-01-01';

/** A valid in-date record with known pattern and matching tags. */
function makeRecord(id: string, tags: string[] = ['toto-wolff', 'governance']): SignalRecord & { pattern: string; topic_tags: string[] } {
  return {
    id,
    content_hash: 'abc123',
    valid_until: '2027-12-31',
    verdict: 'approved',
    pattern: 'architectural-decision-record',
    topic_tags: tags,
  } as SignalRecord & { pattern: string; topic_tags: string[] };
}

describe('scoreConfidence', () => {
  it('returns HIGH for two valid in-date records with matching tags and known pattern', () => {
    const r1 = makeRecord('adr-0006');
    const r2 = makeRecord('adr-0007');
    const result = scoreConfidence([r1, r2] as unknown as SignalRecord[], NOW);
    expect(result.tier).toBe('HIGH');
    expect(result.matchCount).toBe(2);
    expect(result.disqualifiers).toHaveLength(0);
  });

  it('returns LOW when fewer than 2 records', () => {
    const result = scoreConfidence([makeRecord('adr-0006')] as unknown as SignalRecord[], NOW);
    expect(result.tier).toBe('LOW');
    expect(result.disqualifiers[0]).toMatch(/fewer than/);
  });

  it('returns LOW when any record is expired', () => {
    const expired = { ...makeRecord('adr-old'), valid_until: '2020-01-01' };
    const r2 = makeRecord('adr-0007');
    const result = scoreConfidence([expired, r2] as unknown as SignalRecord[], NOW);
    expect(result.tier).toBe('LOW');
    expect(result.disqualifiers.some((d) => d.includes('expired'))).toBe(true);
  });

  it('returns LOW when a record has a novel (unknown) pattern', () => {
    const novel = { ...makeRecord('adr-0006'), pattern: 'some-unknown-pattern' };
    const r2 = makeRecord('adr-0007');
    const result = scoreConfidence([novel, r2] as unknown as SignalRecord[], NOW);
    expect(result.tier).toBe('LOW');
    expect(result.disqualifiers.some((d) => d.includes('novel or missing pattern'))).toBe(true);
  });

  it('returns LOW when a record has no pattern field', () => {
    const noPattern = { ...makeRecord('adr-0006') };
    // @ts-expect-error intentionally removing pattern
    delete noPattern.pattern;
    const r2 = makeRecord('adr-0007');
    const result = scoreConfidence([noPattern, r2] as unknown as SignalRecord[], NOW);
    expect(result.tier).toBe('LOW');
  });

  it('returns LOW when topic_tags Jaccard is below threshold', () => {
    const r1 = makeRecord('adr-0006', ['alpha', 'beta']);
    const r2 = makeRecord('adr-0007', ['gamma', 'delta']);
    const result = scoreConfidence([r1, r2] as unknown as SignalRecord[], NOW);
    expect(result.tier).toBe('LOW');
    expect(result.disqualifiers.some((d) => d.includes('Jaccard'))).toBe(true);
  });

  it('rejects US-format date and throws', () => {
    const r1 = makeRecord('adr-0006');
    const r2 = makeRecord('adr-0007');
    expect(() => scoreConfidence([r1, r2] as unknown as SignalRecord[], '06/24/2026')).toThrow();
  });

  it('canonicalizes pattern before comparing (underscore→hyphen, lowercase)', () => {
    const r1 = { ...makeRecord('adr-0006'), pattern: 'Architectural_Decision_Record' };
    const r2 = makeRecord('adr-0007');
    const result = scoreConfidence([r1, r2] as unknown as SignalRecord[], NOW);
    expect(result.tier).toBe('HIGH');
  });
});
