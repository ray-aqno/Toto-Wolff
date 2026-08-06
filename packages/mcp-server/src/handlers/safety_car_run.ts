import assert from 'node:assert';
import { MCPValidationError } from './vault_write.js';
import type { SafetyCarService, SafetyCarReport } from '@toto-wolff/core';

interface SafetyCarRunInput {
  plan_path: string;
}

function validateInput(raw: unknown): SafetyCarRunInput {
  assert(typeof raw === 'object' && raw !== null, 'input must be object');
  const input = raw as Record<string, unknown>;

  if (typeof input['plan_path'] !== 'string' || input['plan_path'].length === 0) {
    throw new MCPValidationError('plan_path must be non-empty string');
  }

  return { plan_path: input['plan_path'] };
}

export async function handleSafetyCarRun(input: unknown, safetyCar: SafetyCarService): Promise<SafetyCarReport> {
  const { plan_path } = validateInput(input);
  return safetyCar.run(plan_path);
}