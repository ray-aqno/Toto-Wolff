import assert from 'node:assert';
import { MCPValidationError } from './vault_write.js';
import type { CabinetService, CabinetResult } from '@toto-wolff/core';

interface CabinetRunInput {
  subject: string;
  version: string;
  evidence_brief?: string;
}

function validateInput(raw: unknown): CabinetRunInput {
  assert(typeof raw === 'object' && raw !== null, 'input must be object');
  const input = raw as Record<string, unknown>;

  if (typeof input['subject'] !== 'string' || input['subject'].length === 0) {
    throw new MCPValidationError('subject must be non-empty string');
  }
  if (typeof input['version'] !== 'string' || input['version'].length === 0) {
    throw new MCPValidationError('version must be non-empty string');
  }
  if (!/^v\d+\.\d+\.\d+$/.test(input['version'])) {
    throw new MCPValidationError('version must match ^v\\d+\\.\\d+\\.\\d+$');
  }

  if (input['evidence_brief'] !== undefined) {
    if (typeof input['evidence_brief'] !== 'string') {
      throw new MCPValidationError('evidence_brief must be a string when provided');
    }
    if (input['evidence_brief'].length > 10000) {
      throw new MCPValidationError('evidence_brief must not exceed 10000 chars');
    }
  }

  return {
    subject: input['subject'],
    version: input['version'],
    ...(input['evidence_brief'] !== undefined ? { evidence_brief: input['evidence_brief'] } : {}),
  };
}

export async function handleCabinetRun(input: unknown, cabinet: CabinetService): Promise<CabinetResult> {
  const { subject, version, evidence_brief } = validateInput(input);
  return cabinet.run(subject, version, evidence_brief);
}