import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentConfig } from './types.mts';

const CONFIG_DIR_NAME = '.pi';
const VALID_THINKING = ['off', 'minimal', 'low', 'medium', 'high', 'max'] as const;

function getFrontmatter(content: string): { frontmatter: string; systemPrompt: string } | null {
  const matchResult = content.match(/^---\n([\s\S]*?)\n---/);
  if (!matchResult) return null;
  const frontmatter = matchResult[1];
  if (frontmatter === undefined) return null;
  if (!frontmatter) return null;
  const systemPrompt = content.slice(matchResult[0].length).trim();
  return { frontmatter, systemPrompt };
}

export class SubagentService {
  constructor() {}

  list(scope: 'user' | 'project' | 'both' = 'both'): Promise<AgentConfig[]> {
    const agents = this.discoverAgents(process.cwd(), scope);
    return Promise.resolve(this.formatOutput(agents));
  }

  discoverAgents(
    cwd: string,
    scope: 'user' | 'project' | 'both'
  ): Map<string, AgentConfig> {
    const agents = new Map<string, AgentConfig>();

    // User agents only from an explicit PI_CODING_AGENT_DIR: the server never
    // falls back to the home folder (~/.pi/agent also holds pi's credentials;
    // the plugin directory flags a read there, PR #73).
    if ((scope === 'user' || scope === 'both') && process.env['PI_CODING_AGENT_DIR']) {
      const userAgentsDir = path.join(getPiAgentDir(), 'agents');
      if (fs.existsSync(userAgentsDir)) {
        for (const file of fs.readdirSync(userAgentsDir)) {
          if (file.endsWith('.md')) {
            const config = this.parseAgentFile(path.join(userAgentsDir, file), 'user');
            if (config) agents.set(config.name, config);
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
            if (config) agents.set(config.name, config);
          }
        }
      }
    }

    return agents;
  }

  parseAgentFile(filePath: string, source: 'user' | 'project'): AgentConfig | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const extracted = getFrontmatter(content);
      if (!extracted) return null;

      const { frontmatter, systemPrompt } = extracted;

      const parseField = (key: string): string => {
        const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
        return match?.[1]?.trim() ?? '';
      };

      const name = parseField('name') || path.basename(filePath, '.md');
      const description = parseField('description') || '';
      const tools = parseField('tools') || 'read, grep, find, ls';
      const model = parseField('model') || 'claude-sonnet-4-6';
      const thinkingRaw = parseField('thinking');
      const thinking: AgentConfig['thinking'] = (thinkingRaw && VALID_THINKING.includes(thinkingRaw as typeof VALID_THINKING[number]))
        ? (thinkingRaw as AgentConfig['thinking'])
        : 'medium';

      if (name.length === 0 || systemPrompt.length === 0) return null;

      return { name, description, tools, model, thinking, systemPrompt, source, filePath };
    } catch {
      return null;
    }
  }

  formatOutput(agents: Map<string, AgentConfig>): AgentConfig[] {
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
export function getPiAgentDir(
  env: NodeJS.ProcessEnv = process.env,
  home: string = env['HOME'] ?? '',
  platform: NodeJS.Platform = process.platform,
): string {
  const envDir = env['PI_CODING_AGENT_DIR'];
  if (!envDir) return path.join(home, '.pi', 'agent');
  if (envDir === '~') return home;
  if (envDir.startsWith('~/') || (platform === 'win32' && envDir.startsWith('~\\'))) {
    return path.join(home, envDir.slice(2));
  }
  if (/^file:\/\//.test(envDir)) return fileURLToPath(envDir);
  return envDir;
}
