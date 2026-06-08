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

export interface CouncilResult {
  status: 'ok' | 'error';
  ruling?: CouncilRuling;
  planPath?: string;
  error?: string;
}

export interface P10Result {
  status: P10Status | 'error';
  planPath?: string;
  error?: string;
}
