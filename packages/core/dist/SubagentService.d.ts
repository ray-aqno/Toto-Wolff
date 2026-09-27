import type { AgentConfig } from './types.js';
export declare class SubagentService {
    constructor();
    list(scope?: 'user' | 'project' | 'both'): Promise<AgentConfig[]>;
    discoverAgents(cwd: string, scope: 'user' | 'project' | 'both'): Map<string, AgentConfig>;
    parseAgentFile(filePath: string, source: 'user' | 'project'): AgentConfig | null;
    formatOutput(agents: Map<string, AgentConfig>): AgentConfig[];
}
//# sourceMappingURL=SubagentService.d.ts.map