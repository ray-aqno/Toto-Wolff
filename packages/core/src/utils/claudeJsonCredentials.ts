/**
 * Shared ~/.claude.json credential-file reader.
 * Reads ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN/ANTHROPIC_BASE_URL from
 * mcpServers[mcpKey].env. Synchronous and never throws — a missing file,
 * malformed JSON, or missing keys is a normal "not found here" outcome, not
 * an error of its own.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CLAUDE_JSON_PATH = path.join(os.homedir(), '.claude.json');

export function readClaudeJsonEnv(mcpKey: string): { apiKey?: string; authToken?: string; baseUrl?: string } {
  try {
    const raw = fs.readFileSync(CLAUDE_JSON_PATH, 'utf8');
    const json = JSON.parse(raw) as Record<string, unknown>;
    const servers = json['mcpServers'] as Record<string, unknown> | undefined;
    const entry = servers?.[mcpKey] as Record<string, unknown> | undefined;
    const env = entry?.['env'] as Record<string, string> | undefined;
    if (!env) {
      return {};
    }
    const result: { apiKey?: string; authToken?: string; baseUrl?: string } = {};
    if (env['ANTHROPIC_API_KEY']) result.apiKey = env['ANTHROPIC_API_KEY'];
    if (env['ANTHROPIC_AUTH_TOKEN']) result.authToken = env['ANTHROPIC_AUTH_TOKEN'];
    if (env['ANTHROPIC_BASE_URL']) result.baseUrl = env['ANTHROPIC_BASE_URL'];
    return result;
  } catch {
    return {};
  }
}
