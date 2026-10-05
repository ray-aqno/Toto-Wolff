import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getPiAgentDir, SubagentService } from '../../../plugin/server/core/SubagentService.mts';

describe('getPiAgentDir', () => {
  const home = '/home/tester';

  it('defaults to ~/.pi/agent', () => {
    expect(getPiAgentDir({}, home)).toBe(path.join(home, '.pi', 'agent'));
  });

  it('uses PI_CODING_AGENT_DIR when set', () => {
    expect(getPiAgentDir({ PI_CODING_AGENT_DIR: '/opt/pi' }, home)).toBe('/opt/pi');
  });

  it('expands a leading ~/ in PI_CODING_AGENT_DIR', () => {
    expect(getPiAgentDir({ PI_CODING_AGENT_DIR: '~/custom/agent' }, home)).toBe(path.join(home, 'custom', 'agent'));
  });

  it('expands a bare ~ in PI_CODING_AGENT_DIR', () => {
    expect(getPiAgentDir({ PI_CODING_AGENT_DIR: '~' }, home)).toBe(home);
  });

  it('expands a leading ~\\ on Windows only', () => {
    expect(getPiAgentDir({ PI_CODING_AGENT_DIR: '~\\agent' }, home, 'win32')).toBe(path.join(home, 'agent'));
    expect(getPiAgentDir({ PI_CODING_AGENT_DIR: '~\\agent' }, home, 'linux')).toBe('~\\agent');
  });

  it('converts a file:// URL to a path', () => {
    expect(getPiAgentDir({ PI_CODING_AGENT_DIR: 'file:///tmp/pi-agents' }, home, 'linux')).toBe('/tmp/pi-agents');
  });

  it('ignores an empty PI_CODING_AGENT_DIR', () => {
    expect(getPiAgentDir({ PI_CODING_AGENT_DIR: '' }, home)).toBe(path.join(home, '.pi', 'agent'));
  });
});

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

  it('finds user agents under PI_CODING_AGENT_DIR and project agents under .pi/agents', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'toto-subagent-'));
    const userDir = path.join(tmp, 'user-agent-dir');
    const projectDir = path.join(tmp, 'project');
    writeAgent(path.join(userDir, 'agents'), 'user-scout');
    writeAgent(path.join(projectDir, '.pi', 'agents'), 'project-scout');
    process.env['PI_CODING_AGENT_DIR'] = userDir;

    const agents = new SubagentService().discoverAgents(projectDir, 'both');

    expect([...agents.keys()].sort()).toEqual(['project-scout', 'user-scout']);
  });
});
