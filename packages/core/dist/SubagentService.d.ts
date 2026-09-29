import type { AgentConfig } from './types.js';
export declare class SubagentService {
    constructor();
    list(scope?: 'user' | 'project' | 'both'): Promise<AgentConfig[]>;
    discoverAgents(cwd: string, scope: 'user' | 'project' | 'both'): Map<string, AgentConfig>;
    parseAgentFile(filePath: string, source: 'user' | 'project'): AgentConfig | null;
    formatOutput(agents: Map<string, AgentConfig>): AgentConfig[];
}
/**
 * The pi coding agent's user config directory: $PI_CODING_AGENT_DIR if set,
 * otherwise ~/.pi/agent. Mirrors getAgentDir() from
 * @earendil-works/pi-coding-agent 0.83.0 (dist/config.js), including its
 * normalizePath() defaults (dist/utils/paths.js): a bare `~`, a leading `~/`
 * (or `~\` on Windows) expands to the home directory, and a `file://` URL is
 * converted to a path. Reimplemented here because importing that package
 * pulled its whole multi-provider AI stack into the bundled MCP server (about
 * 10 MB of a 12.9 MB bundle), past the plugin directory's 5 MiB per-file limit.
 */
export declare function getPiAgentDir(env?: NodeJS.ProcessEnv, home?: string, platform?: NodeJS.Platform): string;
//# sourceMappingURL=SubagentService.d.ts.map