import type Anthropic from '@anthropic-ai/sdk';
import assert from 'node:assert';

// Verified call-graph ceilings — see P10-Plans/2026-07-02-toto-wolff-token-budget-enforcement.md.
// Council: 9 = max legitimate _callModel calls (8-call full chain + 1 fast-path
// attempt that returns null and falls through). CouncilService.ts _callModel max_tokens=1024.
export const COUNCIL_MAX_CALLS = 9;
const COUNCIL_MAX_TOKENS_PER_CALL = 1024;
export const COUNCIL_STATIC_CEILING = COUNCIL_MAX_CALLS * COUNCIL_MAX_TOKENS_PER_CALL;

// P10: 9 = max legitimate callModel calls (7-call base pipeline + 2 for one
// MAX_REVISIONS=1 cycle). P10Service.ts callModel max_tokens=2048.
export const P10_MAX_CALLS = 9;
const P10_MAX_TOKENS_PER_CALL = 2048;
export const P10_STATIC_CEILING = P10_MAX_CALLS * P10_MAX_TOKENS_PER_CALL;

export interface UsageRecord {
  usage: Anthropic.Usage;
  callSite: string;
}

/** Shared vault-record flag value — reused by CouncilResult and P10Result. */
export type BudgetFlag = 'fanout_overrun';

export type BudgetVerdict =
  | { kind: 'ok' }
  | { kind: 'seat_overrun'; totalTokens: number }
  | { kind: 'fanout_overrun'; totalTokens: number; ceiling: number };

/**
 * Wraps a model response's usage field into a UsageRecord. Never throws —
 * degrades to a zeroed record on missing/malformed usage data, matching the
 * degrade-don't-throw pattern in CouncilService.run()'s detectReversal call.
 */
export function trackUsage(usage: Anthropic.Usage | undefined, callSite: string): UsageRecord {
  try {
    assert(callSite.length > 0, 'callSite must be non-empty');
    const inputTokens = usage !== undefined && Number.isFinite(usage.input_tokens) ? usage.input_tokens : 0;
    const outputTokens = usage !== undefined && Number.isFinite(usage.output_tokens) ? usage.output_tokens : 0;
    return { usage: { input_tokens: inputTokens, output_tokens: outputTokens }, callSite };
  } catch {
    return { usage: { input_tokens: 0, output_tokens: 0 }, callSite: 'unknown' };
  }
}

/**
 * Pure verdict function — no console, no I/O. Distinguishes a legitimate
 * deep session (seat_overrun: call count within maxCalls, tokens trending
 * high) from a structural fan-out bug (fanout_overrun: call count or
 * aggregate usage exceeds what the fixed call graph can produce).
 */
export function checkSessionBudget(records: UsageRecord[], ceiling: number, maxCalls: number): BudgetVerdict {
  assert(ceiling > 0, 'ceiling must be positive');
  assert(maxCalls > 0, 'maxCalls must be positive');

  let totalTokens = 0;
  for (let i = 0; i < records.length; i++) { // P10 Rule 2: bounded by records.length (session-scoped, <= maxCalls in practice)
    const record = records[i];
    if (record === undefined) continue;
    totalTokens += record.usage.input_tokens + record.usage.output_tokens;
  }

  if (records.length > maxCalls || totalTokens > ceiling) {
    return { kind: 'fanout_overrun', totalTokens, ceiling };
  }
  if (totalTokens > ceiling * 0.85) {
    return { kind: 'seat_overrun', totalTokens };
  }
  return { kind: 'ok' };
}
