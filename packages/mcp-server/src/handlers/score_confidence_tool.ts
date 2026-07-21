import assert from 'node:assert';
import type { SignalRecord } from '@toto-wolff/core';
import { scoreConfidence } from './scoreConfidence.js';
import { SignalIndex } from './signal_index.js';

const COLD_START_DISQUALIFIER = "Signal store is empty — run 'toto backfill' to seed from your council and p10 history";

/** Escapes regex metacharacters so a topic tag can be embedded in a RegExp literal. */
function escapeRegExp(s: string): string {
  assert(typeof s === 'string', 's must be a string');
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Selects the active SignalRecords relevant to a ruling: a record is relevant
 * when any of its topic_tags occurs in the ruling text as a whole word/phrase.
 * Word-boundary (\b) matching — not bare substring — is deliberate: a substring
 * test lets a short tag like "or" match "order"/"explore" and drag unrelated
 * records into the scored set, where their divergent tags fail scoreConfidence's
 * pairwise Jaccard check and silently degrade a valid HIGH to LOW.
 * Hyphenated multi-word tags (e.g. "service-boundary") match as a unit because
 * \b anchors the tag's outer alphanumeric edges.
 */
function selectRelevant(records: SignalRecord[], ruling: string): SignalRecord[] {
  assert(Array.isArray(records), 'records must be an array');
  assert(typeof ruling === 'string', 'ruling must be a string');
  const haystack = ruling.toLowerCase();
  return records.filter((r) => {
    const tags = r.topic_tags ?? [];
    for (let i = 0; i < tags.length; i++) { // P10 Rule 2: bounded by tags.length
      const tag = (tags[i] ?? '').toLowerCase();
      if (tag.length === 0) continue;
      const wordMatch = new RegExp(`\\b${escapeRegExp(tag)}\\b`);
      if (wordMatch.test(haystack)) return true;
    }
    return false;
  });
}

/**
 * MCP tool handler for score_confidence.
 * Takes a free-text council `ruling`, loads the vault's active SignalRecords,
 * selects those topically relevant to the ruling (whole-word tag match), and
 * scores that set as of today. When no active records exist at all — dir
 * absent, empty, or holding only expired/invalid files (SignalIndex.load drops
 * all three) — returns LOW with cold-start guidance. Having records but none
 * relevant falls to LOW via scoreConfidence's distinct-record floor.
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
  const index = new SignalIndex(vaultPath);
  await index.load();
  const all = index.getAll();

  // Cold-start: no active records to score against, whatever the reason.
  if (all.length === 0) {
    return { tier: 'LOW', matchCount: 0, disqualifiers: [COLD_START_DISQUALIFIER] };
  }

  const relevant = selectRelevant(all, ruling);
  const now = new Date().toISOString().slice(0, 10); // YYYY-MM-DD — same clock SignalIndex.load uses
  return scoreConfidence(relevant, now);
}
