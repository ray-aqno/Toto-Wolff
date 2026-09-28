import assert from 'node:assert';
import { MCPValidationError } from './vault_write.js';
function validateInput(raw) {
    assert(typeof raw === 'object' && raw !== null, 'input must be object');
    const input = raw;
    if (input['scope'] !== undefined) {
        if (typeof input['scope'] !== 'string') {
            throw new MCPValidationError('scope must be a string when provided');
        }
        if (!['user', 'project', 'both'].includes(input['scope'])) {
            throw new MCPValidationError('scope must be one of: user, project, both');
        }
    }
    return {
        ...(input['scope'] !== undefined ? { scope: input['scope'] } : {}),
    };
}
export async function handleSubagentList(input, subagent) {
    const { scope } = validateInput(input);
    return subagent.list(scope);
}
//# sourceMappingURL=subagent_list.js.map