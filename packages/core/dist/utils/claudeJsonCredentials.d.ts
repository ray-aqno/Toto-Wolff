/**
 * Shared ~/.claude.json credential-file reader.
 * Reads ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN/ANTHROPIC_BASE_URL from
 * mcpServers[mcpKey].env. Synchronous and never throws — a missing file,
 * malformed JSON, or missing keys is a normal "not found here" outcome, not
 * an error of its own.
 */
/**
 * Reads credential values from ~/.claude.json for the given MCP server.
 * Returns an empty object when the file is missing, malformed, or has no matching credentials.
 */
export declare function readClaudeJsonEnv(mcpKey: string): {
    apiKey?: string;
    authToken?: string;
    baseUrl?: string;
};
//# sourceMappingURL=claudeJsonCredentials.d.ts.map