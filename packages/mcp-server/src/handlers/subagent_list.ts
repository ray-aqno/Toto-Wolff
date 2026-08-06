import assert from 'node:assert';
import { MCPValidationError } from './vault_write.js';
import type { SubagentService, AgentConfig } from '@toto-wolff/core';

interface SubagentListInput {
  scope?: 'user' | 'project' | 'both';
}

function validateInput(raw: unknown): SubagentListInput {
  assert(typeof raw === 'object' && raw !== null, 'input must be object');
  const input = raw as Record<string, unknown>;

  if (input['scope'] !== undefined) {
    if (typeof input['scope'] !== 'string') {
      throw new MCPValidationError('scope must be a string when provided');
    }
    if (!['user', 'project', 'both'].includes(input['scope'])) {
      throw new MCPValidationError('scope must be one of: user, project, both');
    }
  }

  return {
    ...(input['scope'] !== undefined ? { scope: input['scope'] as 'user' | 'project' | 'both' } : {}),
  };
}

export async function handleSubagentList(input: unknown, subagent: SubagentService): Promise<AgentConfig[]> {
  const { scope } = validateInput(input);
  return subagent.list(scope);
}