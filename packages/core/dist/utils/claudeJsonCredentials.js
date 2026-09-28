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
/**
 * Reads credential values from ~/.claude.json for the given MCP server.
 * Returns an empty object when the file is missing, malformed, or has no matching credentials.
 */
export function readClaudeJsonEnv(mcpKey) {
    try {
        const raw = fs.readFileSync(CLAUDE_JSON_PATH, 'utf8');
        const json = JSON.parse(raw);
        const servers = json['mcpServers'];
        const entry = servers?.[mcpKey];
        const env = entry?.['env'];
        if (!env) {
            return {};
        }
        const result = {};
        if (env['ANTHROPIC_API_KEY'])
            result.apiKey = env['ANTHROPIC_API_KEY'];
        if (env['ANTHROPIC_AUTH_TOKEN'])
            result.authToken = env['ANTHROPIC_AUTH_TOKEN'];
        if (env['ANTHROPIC_BASE_URL'])
            result.baseUrl = env['ANTHROPIC_BASE_URL'];
        return result;
    }
    catch {
        return {};
    }
}
//# sourceMappingURL=claudeJsonCredentials.js.map