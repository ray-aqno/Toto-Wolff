import assert from 'node:assert';
import { isSignalRecord } from '@toto-wolff/core';
import { scoreConfidence } from './scoreConfidence.js';

/**
 * MCP tool handler for score_confidence.
 * Validates the records array and now date, delegates to scoreConfidence.
 * Registered as a TOOLS entry so skills can invoke it as a real tool call
 * rather than relying on model-level prose execution.
 */
export function handleScoreConfidence(body: unknown): { tier: 'HIGH' | 'LOW'; matchCount: number; disqualifiers: string[] } {
  assert(typeof body === 'object' && body !== null, 'body must be an object');
  const b = body as Record<string, unknown>;

  assert(typeof b['now'] === 'string', 'now must be a string');
  const now = b['now'] as string;

  assert(Array.isArray(b['records']), 'records must be an array');
  const raw = b['records'] as unknown[];

  // P10 Rule 2: bounded by raw.length (caller-supplied array, validated below)
  // P10 Rule 5: isSignalRecord is the type guard assertion
  const records = raw.filter(isSignalRecord);

  assert(records.length === raw.length, `${raw.length - records.length} record(s) failed SignalRecord validation`);

  return scoreConfidence(records, now);
}
