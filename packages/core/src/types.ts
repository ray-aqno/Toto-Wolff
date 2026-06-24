export class VaultCommitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultCommitError';
  }
}

export class VaultSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultSearchError';
  }
}

export class LLMTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMTimeoutError';
  }
}

export class P10BlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'P10BlockedError';
  }
}

export interface VaultWriteResult {
  success: boolean;
  path: string;
}

export interface SearchResult {
  file: string;
  line: number;
  text: string;
}

export type CouncilStatus = 'approved' | 'revision-required' | 'blocked';
export type P10Status = 'approved' | 'revision-required' | 'blocked';

export interface CouncilRuling {
  status: CouncilStatus;
  summary: string;
  conditions?: string[];
}

export interface P10Ruling {
  status: P10Status;
  summary: string;
  requiredChanges?: string;
}

export interface P10Result {
  status: P10Status | 'error';
  planPath?: string;
  error?: string;
}

/**
 * Closed enum of valid pattern values for SignalRecord.
 * Adding a new pattern requires a code change — this is intentional (write-path enforcement).
 * Per council ruling 2026-06-23-toto-wolff-v1-confidence-scoring-contract.
 */
export const SIGNAL_PATTERNS = [
  'shared-session-state-auth-extraction',
  'architectural-decision-record',
  'p10-approved-plan',
] as const;

export type SignalPattern = typeof SIGNAL_PATTERNS[number];

/** Typed governance signal record — minimum fields required by the spike. */
export interface SignalRecord {
  id: string;
  content_hash: string;
  valid_until: string;
  verdict: 'approved' | 'blocked' | 'conditional-approve' | 'revision-required';
}

/** isSignalRecord is the only legal path from unknown to SignalRecord. */
export function isSignalRecord(v: unknown): v is SignalRecord {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r['id'] === 'string' && r['id'].length > 0 &&
    typeof r['content_hash'] === 'string' && r['content_hash'].length > 0 &&
    typeof r['valid_until'] === 'string' && r['valid_until'].length > 0 &&
    typeof r['verdict'] === 'string' && r['verdict'].length > 0
  );
}
