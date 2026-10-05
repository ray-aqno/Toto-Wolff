import assert from 'node:assert';
import { MCPValidationError } from './vault_write.mts';
import type { DRSService } from '../core/DRSService.mts';
import type { DRSResult, DRSCheckInput } from '../core/types.mts';

function validateInput(raw: unknown): DRSCheckInput {
  assert(typeof raw === 'object' && raw !== null, 'input must be object');
  const input = raw as Record<string, unknown>;

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
  } else {
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
      command: input['command'] as string,
      messageBefore: input['message_before'],
    } as DRSCheckInput;
  } else {
    return {
      tool: tool as 'Write' | 'Edit' | 'NotebookEdit' | 'Bash',
      targetPath: input['target_path'] as string,
      messageBefore: input['message_before'],
    } as DRSCheckInput;
  }
}

export async function handleDrsCheck(input: unknown, drs: DRSService): Promise<DRSResult> {
  const validated = validateInput(input);
  return drs.check(validated);
}