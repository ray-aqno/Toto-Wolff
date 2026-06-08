import assert from 'node:assert';
import { MCPValidationError } from './vault_write.js';
import type { VaultService, SearchResult } from '@toto-wolff/core';

interface VaultSearchInput {
  query: string;
}

function validateInput(raw: unknown): VaultSearchInput {
  assert(typeof raw === 'object' && raw !== null, 'input must be object');
  const input = raw as Record<string, unknown>;
  if (typeof input['query'] !== 'string' || input['query'].length === 0) {
    throw new MCPValidationError('query must be non-empty string');
  }
  return { query: input['query'] };
}

export async function handleVaultSearch(input: unknown, vault: VaultService): Promise<SearchResult[]> {
  const { query } = validateInput(input);
  return vault.search(query);
}
