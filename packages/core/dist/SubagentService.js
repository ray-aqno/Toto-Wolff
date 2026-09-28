import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
const CONFIG_DIR_NAME = '.pi';
const VALID_THINKING = ['off', 'minimal', 'low', 'medium', 'high', 'max'];
function getFrontmatter(content) {
    const matchResult = content.match(/^---\n([\s\S]*?)\n---/);
    if (!matchResult)
        return null;
    const frontmatter = matchResult[1];
    if (frontmatter === undefined)
        return null;
    if (!frontmatter)
        return null;
    const systemPrompt = content.slice(matchResult[0].length).trim();
    return { frontmatter, systemPrompt };
}
export class SubagentService {
    constructor() { }
    async list(scope = 'both') {
        const agents = this.discoverAgents(process.cwd(), scope);
        return this.formatOutput(agents);
    }
    discoverAgents(cwd, scope) {
        const agents = new Map();
        if (scope === 'user' || scope === 'both') {
            const userAgentsDir = path.join(getAgentDir(), 'agents');
            if (fs.existsSync(userAgentsDir)) {
                for (const file of fs.readdirSync(userAgentsDir)) {
                    if (file.endsWith('.md')) {
                        const config = this.parseAgentFile(path.join(userAgentsDir, file), 'user');
                        if (config)
                            agents.set(config.name, config);
                    }
                }
            }
        }
        if (scope === 'project' || scope === 'both') {
            const projectAgentsDir = path.join(cwd, CONFIG_DIR_NAME, 'agents');
            if (fs.existsSync(projectAgentsDir)) {
                for (const file of fs.readdirSync(projectAgentsDir)) {
                    if (file.endsWith('.md')) {
                        const config = this.parseAgentFile(path.join(projectAgentsDir, file), 'project');
                        if (config)
                            agents.set(config.name, config);
                    }
                }
            }
        }
        return agents;
    }
    parseAgentFile(filePath, source) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const extracted = getFrontmatter(content);
            if (!extracted)
                return null;
            const { frontmatter, systemPrompt } = extracted;
            const parseField = (key) => {
                const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
                return match?.[1]?.trim() ?? '';
            };
            const name = parseField('name') || path.basename(filePath, '.md');
            const description = parseField('description') || '';
            const tools = parseField('tools') || 'read, grep, find, ls';
            const model = parseField('model') || 'claude-sonnet-4-6';
            const thinkingRaw = parseField('thinking');
            const thinking = (thinkingRaw && VALID_THINKING.includes(thinkingRaw))
                ? thinkingRaw
                : 'medium';
            if (name.length === 0 || systemPrompt.length === 0)
                return null;
            return { name, description, tools, model, thinking, systemPrompt, source, filePath };
        }
        catch {
            return null;
        }
    }
    formatOutput(agents) {
        return Array.from(agents.values()).map((a) => ({
            name: a.name,
            description: a.description,
            tools: a.tools,
            model: a.model,
            thinking: a.thinking,
            systemPrompt: a.systemPrompt,
            source: a.source,
            filePath: a.filePath,
        }));
    }
}
//# sourceMappingURL=SubagentService.js.map