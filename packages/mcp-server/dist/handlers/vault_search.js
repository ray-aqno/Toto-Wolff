import assert from 'node:assert';
import { MCPValidationError } from './vault_write.js';
function validateInput(raw) {
    assert(typeof raw === 'object' && raw !== null, 'input must be object');
    const input = raw;
    if (typeof input['query'] !== 'string' || input['query'].length === 0) {
        throw new MCPValidationError('query must be non-empty string');
    }
    return { query: input['query'] };
}
export async function handleVaultSearch(input, vault) {
    const { query } = validateInput(input);
    return vault.search(query);
}
//# sourceMappingURL=vault_search.js.map