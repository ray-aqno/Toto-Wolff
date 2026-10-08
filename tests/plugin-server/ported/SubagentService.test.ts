import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SubagentService } from '../../../plugin/server/core/SubagentService.mts';

// 2.0.0: getPiAgentDir and user-scope discovery are removed (the plugin
// directory refuses reading the pi agent folder); spec criterion 9 amended.

describe('SubagentService.discoverAgents', () => {
  const originalEnv = process.env['PI_CODING_AGENT_DIR'];
  let tmp: string | undefined;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env['PI_CODING_AGENT_DIR'];
    else process.env['PI_CODING_AGENT_DIR'] = originalEnv;
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  function writeAgent(dir: string, name: string): void {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${name}.md`),
      `---\nname: ${name}\ndescription: test agent ${name}\n---\nYou are ${name}.\n`,
    );
  }

  it('finds project agents under .pi/agents and never user agents (2.0.0)', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'toto-subagent-'));
    const userDir = path.join(tmp, 'user-agent-dir');
    const projectDir = path.join(tmp, 'project');
    writeAgent(path.join(userDir, 'agents'), 'user-scout');
    writeAgent(path.join(projectDir, '.pi', 'agents'), 'project-scout');
    process.env['PI_CODING_AGENT_DIR'] = userDir;

    const agents = new SubagentService().discoverAgents(projectDir, 'both');

    expect([...agents.keys()].sort()).toEqual(['project-scout']);
  });
});
