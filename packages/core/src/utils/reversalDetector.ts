import assert from 'node:assert';
import { isSignalRecord } from '../types.js';
import type { SignalRecord } from '../types.js';
import { jaccardSimilarity } from './jaccard.js';
import { REVERSAL_JACCARD_THRESHOLD, SIGNAL_MAX_PRIORS } from './constants.js';

export interface ReversalResult {
  /** ID of the prior SignalRecord whose verdict conflicts with currentVerdict. */
  priorId: string;
  /** Jaccard similarity score that triggered the match. */
  similarity: number;
  /** Prior verdict that conflicts. */
  priorVerdict: string;
}

/**
 * Detects whether currentVerdict conflicts with a prior ruling on the same topic.
 *
 * Pure synchronous scan of priors. No I/O. Caller (mcp-server handler) owns
 * loading priors via SignalIndex and must catch VaultSearchError before calling here.
 * Caller also owns currentTags — pass the topic_tags from the SignalRecord
 * the handler constructs for the current session. Do not derive tags from summary text.
 *
 * P10 Rule 2: priors bounded by SignalIndex.MAX_RECORDS = 500 (SIGNAL_MAX_PRIORS).
 * P10 Rule 7: no async, no I/O. Async boundary is entirely in the caller.
 */
export function detectReversal(
  currentVerdict: string,
  currentTags: string[],
  priors: SignalRecord[],
): ReversalResult | null {
  assert(typeof currentVerdict === 'string' && currentVerdict.length > 0, 'currentVerdict must be non-empty string');
  assert(Array.isArray(currentTags), 'currentTags must be a string[]');
  assert(Array.isArray(priors), 'priors must be an array');
  // P10-R2: bounded by SignalIndex MAX_RECORDS = 500. If SignalIndex's own cap
  // has an off-by-one bug, degrade gracefully via truncation instead of crashing
  // the whole council run.
  const boundedPriors = priors.length > SIGNAL_MAX_PRIORS ? priors.slice(0, SIGNAL_MAX_PRIORS) : priors;

  for (let i = 0; i < boundedPriors.length; i++) { // P10 Rule 2: bounded by boundedPriors.length ≤ SIGNAL_MAX_PRIORS
    const prior = boundedPriors[i];
    if (prior == null || !isSignalRecord(prior)) continue;
    const sim = jaccardSimilarity(currentTags, prior.topic_tags ?? []);
    if (sim >= REVERSAL_JACCARD_THRESHOLD && prior.verdict !== currentVerdict) {
      return { priorId: prior.id, similarity: sim, priorVerdict: prior.verdict };
    }
  }

  return null;
}
