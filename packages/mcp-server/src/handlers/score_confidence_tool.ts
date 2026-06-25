import assert from 'node:assert';
import { isSignalRecord } from '@toto-wolff/core';
import { scoreConfidence } from './scoreConfidence.js';
import { isSignalDirEmpty } from './signal_index.js';

const COLD_START_DISQUALIFIER = "Signal store is empty — run 'toto backfill' to seed from your council and p10 history";

/**
 * MCP tool handler for score_confidence.
 * Validates the records array and now date, checks for cold-start state,
 * then delegates to scoreConfidence. Returns LOW with cold-start guidance
 * when Signals/ dir is absent or empty and no records were supplied.
 */
export async function handleScoreConfidence(
  body: unknown,
  vaultPath: string,
): Promise<{ tier: 'HIGH' | 'LOW'; matchCount: number; disqualifiers: string[] }> {
  assert(typeof body === 'object' && body !== null, 'body must be an object');
  // justified: body is external MCP input (unknown); guarded by typeof assertion above
  const b = body as Record<string, unknown>;

  assert(typeof b['now'] === 'string', 'now must be a string');
  const now = b['now'] as string;

  assert(Array.isArray(b['records']), 'records must be an array');
  const raw = b['records'] as unknown[];

  // P10 Rule 2: bounded by raw.length (caller-supplied array, validated below)
  // P10 Rule 5: isSignalRecord is the type guard assertion
  const records = raw.filter(isSignalRecord);

  assert(records.length === raw.length, `${raw.length - records.length} record(s) failed SignalRecord validation`);

  // Cold-start: dir absent or empty AND no records supplied → surface actionable guidance
  assert(typeof vaultPath === 'string' && vaultPath.length > 0, 'vaultPath must be non-empty string');
  if (records.length === 0 && await isSignalDirEmpty(vaultPath)) {
    return { tier: 'LOW', matchCount: 0, disqualifiers: [COLD_START_DISQUALIFIER] };
  }

  return scoreConfidence(records, now);
}
