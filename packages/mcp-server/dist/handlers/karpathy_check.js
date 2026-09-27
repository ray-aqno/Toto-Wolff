import assert from 'node:assert';
import { MCPValidationError } from './vault_write.js';
function validateInput(raw) {
    assert(typeof raw === 'object' && raw !== null, 'input must be object');
    const input = raw;
    if (typeof input['plan_path'] !== 'string' || input['plan_path'].length === 0) {
        throw new MCPValidationError('plan_path must be non-empty string');
    }
    if (typeof input['stage'] !== 'string' || input['stage'].length === 0) {
        throw new MCPValidationError('stage must be non-empty string');
    }
    if (input['diff'] !== undefined && typeof input['diff'] !== 'string') {
        throw new MCPValidationError('diff must be a string when provided');
    }
    return {
        plan_path: input['plan_path'],
        stage: input['stage'],
        ...(input['diff'] !== undefined ? { diff: input['diff'] } : {}),
    };
}
export async function handleKarpathyCheck(input, karpathy) {
    const { plan_path, stage, diff } = validateInput(input);
    return karpathy.check(plan_path, stage, diff);
}
//# sourceMappingURL=karpathy_check.js.map