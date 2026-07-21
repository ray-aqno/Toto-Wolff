import assert from 'node:assert';
import type { SignalRecord } from '@toto-wolff/core';
import { scoreConfidence } from './scoreConfidence.js';
import { SignalIndex, isSignalDirEmpty } from './signal_index.js';

const COLD_START_DISQUALIFIER = "Signal store is empty — run 'toto backfill' to seed from your council and p10 history";

/**
 * Selects the active SignalRecords relevant to a ruling: a record is relevant
 * when any of its topic_tags appears (case-insensitively) in the ruling text.
 * This keeps the scored set topically coherent, which is what scoreConfidence's
 * pairwise Jaccard check assumes — scoring the whole store together would
 * conflate unrelated decisions and always fall to LOW.
 */
function selectRelevant(records: SignalRecord[], ruling: string): SignalRecord[] {
  assert(Array.isArray(records), 'records must be an array');
  assert(typeof ruling === 'string', 'ruling must be a string');
  const haystack = ruling.toLowerCase();
  return records.filter((r) => {
    const tags = r.topic_tags ?? [];
    for (let i = 0; i < tags.length; i++) { // P10 Rule 2: bounded by tags.length
      const tag = (tags[i] ?? '').toLowerCase();
      if (tag.length > 0 && haystack.includes(tag)) return true;
    }
    return false;
  });
}

/**
 * MCP tool handler for score_confidence.
 * Takes a free-text council `ruling`, loads the vault's active SignalRecords,
 * selects those topically relevant to the ruling, and scores that set as of
 * today. Returns LOW with cold-start guidance when the Signals/ dir is absent
 * or empty. Fewer than two relevant records naturally scores LOW via
 * scoreConfidence's distinct-record floor.
 */
export async function handleScoreConfidence(
  body: unknown,
  vaultPath: string,
): Promise<{ tier: 'HIGH' | 'LOW'; matchCount: number; disqualifiers: string[] }> {
  assert(typeof body === 'object' && body !== null, 'body must be an object');
  // justified: body is external MCP input (unknown); guarded by typeof assertion above
  const b = body as Record<string, unknown>;

  assert(typeof b['ruling'] === 'string' && b['ruling'].length > 0, 'ruling must be a non-empty string');
  const ruling = b['ruling'] as string;

  assert(typeof vaultPath === 'string' && vaultPath.length > 0, 'vaultPath must be non-empty string');
  if (await isSignalDirEmpty(vaultPath)) {
    return { tier: 'LOW', matchCount: 0, disqualifiers: [COLD_START_DISQUALIFIER] };
  }

  const index = new SignalIndex(vaultPath);
  await index.load();
  const relevant = selectRelevant(index.getAll(), ruling);

  const now = new Date().toISOString().slice(0, 10); // YYYY-MM-DD — same clock SignalIndex.load uses
  return scoreConfidence(relevant, now);
}
