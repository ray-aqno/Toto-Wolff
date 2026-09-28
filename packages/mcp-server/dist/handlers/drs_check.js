import assert from 'node:assert';
import { MCPValidationError } from './vault_write.js';
function validateInput(raw) {
    assert(typeof raw === 'object' && raw !== null, 'input must be object');
    const input = raw;
    if (typeof input['tool'] !== 'string') {
        throw new MCPValidationError('tool must be a string');
    }
    const tool = input['tool'];
    if (!['Write', 'Edit', 'NotebookEdit', 'Bash'].includes(tool)) {
        throw new MCPValidationError('tool must be one of: Write, Edit, NotebookEdit, Bash');
    }
    if (tool === 'Bash') {
        if (typeof input['command'] !== 'string') {
            throw new MCPValidationError('command must be a string for Bash tool');
        }
    }
    else {
        if (typeof input['target_path'] !== 'string' || input['target_path'].length === 0) {
            throw new MCPValidationError('target_path must be non-empty string for Write/Edit/NotebookEdit');
        }
    }
    if (input['message_before'] !== undefined && typeof input['message_before'] !== 'string') {
        throw new MCPValidationError('message_before must be a string when provided');
    }
    if (tool === 'Bash') {
        return {
            tool: tool,
            command: input['command'],
            messageBefore: input['message_before'],
        };
    }
    else {
        return {
            tool: tool,
            targetPath: input['target_path'],
            messageBefore: input['message_before'],
        };
    }
}
export async function handleDrsCheck(input, drs) {
    const validated = validateInput(input);
    return drs.check(validated);
}
//# sourceMappingURL=drs_check.js.map