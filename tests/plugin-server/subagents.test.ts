// subagent_list never reads the home folder (2.0.0, plugin directory review):
// user agents come only from an explicit PI_CODING_AGENT_DIR.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SubagentService } from '../../plugin/server/core/SubagentService.mts';

let root: string;
const saved = { HOME: process.env['HOME'], PI: process.env['PI_CODING_AGENT_DIR'] };

function agent(dir: string, name: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), `---\nname: ${name}\ndescription: ${name}\n---\nprompt\n`);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'toto-subagents-'));
  process.env['HOME'] = join(root, 'home');
  delete process.env['PI_CODING_AGENT_DIR'];
  agent(join(root, 'home', '.pi', 'agent', 'agents'), 'home-agent');
  agent(join(root, 'project', '.pi', 'agents'), 'project-agent');
});

afterEach(() => {
  for (const [k, v] of [['HOME', saved.HOME], ['PI_CODING_AGENT_DIR', saved.PI]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(root, { recursive: true, force: true });
});

describe('subagent discovery', () => {
  it('ignores ~/.pi/agent when PI_CODING_AGENT_DIR is not set', () => {
    expect([...new SubagentService().discoverAgents(join(root, 'project'), 'both').keys()]).toEqual(['project-agent']);
  });

  it('reads user agents from an explicit PI_CODING_AGENT_DIR', () => {
    process.env['PI_CODING_AGENT_DIR'] = join(root, 'home', '.pi', 'agent');
    expect([...new SubagentService().discoverAgents(join(root, 'project'), 'both').keys()].sort()).toEqual(['home-agent', 'project-agent']);
  });
});
