import assert from 'node:assert';
import { MCPValidationError } from './vault_write.mts';
import type { VaultService } from '../core/vault/VaultService.mts';
import type { SearchResult } from '../core/types.mts';

const MAX_QUERY_LENGTH = 500;
// Characters that suggest the caller expected a regular expression.
const REGEX_METACHARACTERS = /[|[\]()*+?^$\\]/;
const LITERAL_NOTE = 'No matches. vault_search matches the query as literal, case-sensitive text, not a regular expression.';

interface VaultSearchInput {
  query: string;
}

export interface VaultSearchOutput {
  results: SearchResult[];
  truncated: boolean;
  note?: string;
}

function validateInput(raw: unknown): VaultSearchInput {
  assert(typeof raw === 'object' && raw !== null, 'input must be object');
  const input = raw as Record<string, unknown>;
  if (typeof input['query'] !== 'string' || input['query'].length === 0) {
    throw new MCPValidationError('query must be non-empty string');
  }
  if (input['query'].length > MAX_QUERY_LENGTH) {
    throw new MCPValidationError(`query must not exceed ${String(MAX_QUERY_LENGTH)} characters`);
  }
  return { query: input['query'] };
}

/**
 * Literal, case-sensitive search. When nothing matched, nothing was cut and
 * the query looks like a regular expression, a note says matching is literal
 * (v1.6 matched regular expressions).
 */
export async function handleVaultSearch(input: unknown, vault: VaultService): Promise<VaultSearchOutput> {
  const { query } = validateInput(input);
  const { results, truncated } = await vault.searchBounded(query);
  assert(Array.isArray(results), 'search results must be an array');
  if (results.length === 0 && !truncated && REGEX_METACHARACTERS.test(query)) {
    return { results, truncated, note: LITERAL_NOTE };
  }
  return { results, truncated };
}
