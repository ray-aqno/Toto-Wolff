import assert from 'node:assert';
import { MCPValidationError } from './vault_write.js';
function validateInput(raw) {
    assert(typeof raw === 'object' && raw !== null, 'input must be object');
    const input = raw;
    if (typeof input['plan_path'] !== 'string' || input['plan_path'].length === 0) {
        throw new MCPValidationError('plan_path must be non-empty string');
    }
    return { plan_path: input['plan_path'] };
}
export async function handleSafetyCarRun(input, safetyCar) {
    const { plan_path } = validateInput(input);
    return safetyCar.run(plan_path);
}
//# sourceMappingURL=safety_car_run.js.map