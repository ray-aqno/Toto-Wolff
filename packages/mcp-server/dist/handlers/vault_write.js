import assert from 'node:assert';
export class MCPValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'MCPValidationError';
    }
}
function validateInput(raw) {
    assert(typeof raw === 'object' && raw !== null, 'input must be object');
    const input = raw;
    // CSO: validate types at MCP boundary before touching vault
    if (typeof input['path'] !== 'string' || input['path'].length === 0) {
        throw new MCPValidationError('path must be non-empty string');
    }
    if (typeof input['content'] !== 'string' || input['content'].length === 0) {
        throw new MCPValidationError('content must be non-empty string');
    }
    return { path: input['path'], content: input['content'] };
}
export async function handleVaultWrite(input, vault) {
    const { path, content } = validateInput(input);
    await vault.write(path, content);
    // CSO: return caller's relative path — not the absolute disk path (info disclosure)
    return { path };
}
//# sourceMappingURL=vault_write.js.map