import assert from 'node:assert';
import { MCPValidationError } from './vault_write.js';
import type { KarpathyService, KarpathyCheck } from '@toto-wolff/core';

interface KarpathyCheckInput {
  plan_path: string;
  stage: string;
  diff?: string;
}

function validateInput(raw: unknown): KarpathyCheckInput {
  assert(typeof raw === 'object' && raw !== null, 'input must be object');
  const input = raw as Record<string, unknown>;

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

export async function handleKarpathyCheck(input: unknown, karpathy: KarpathyService): Promise<KarpathyCheck> {
  const { plan_path, stage, diff } = validateInput(input);
  return karpathy.check(plan_path, stage, diff);
}