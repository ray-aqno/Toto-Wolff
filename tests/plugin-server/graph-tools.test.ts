// The eight graph tools through the real server, in both MCP eras: a full
// run, graph errors as { error: { code, message } } results, -32602 for bad
// arguments, evidence kept out of state.json, and spec criterion 12.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../../plugin/server/mcp/server.mts';
import type { LineHandler } from '../../plugin/server/mcp/server.mts';
import { createRuntime } from '../../plugin/server/runtime.mts';
import { createTools } from '../../plugin/server/tools/index.mts';
import { templateHeadings } from '../../plugin/server/graph/templates.mts';
import { loadUserGraphs } from '../../plugin/server/graph/graphs.mts';

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), '../../plugin');
const META = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} };
const GRAPH = {
  id: 'demo',
  version: 1,
  nodes: [
    { id: 'spec', kind: 'skill', skill: '/spec', instruction: 'scope it' },
    { id: 'pick', kind: 'choice', instruction: 'rfc or adr', options: { rfc: ['rfc'], adr: ['adr'] } },
    { id: 'rfc', kind: 'skill', skill: '/rfc', instruction: 'write the rfc' },
    { id: 'adr', kind: 'skill', skill: '/adr', instruction: 'write the adr' },
    { id: 'ok', kind: 'human_gate', instruction: 'approve?' },
    { id: 'build', kind: 'loop', skill: '/karpathy', instruction: 'build it' },
  ],
  edges: [['spec', 'pick'], ['pick', 'rfc'], ['pick', 'adr'], ['rfc', 'ok'], ['adr', 'ok'], ['ok', 'build']],
};

let project: string;
let handle: LineHandler;
let live: ChildProcess;

async function call(name: string, args: Record<string, unknown>, modern = false): Promise<Record<string, unknown>> {
  const line = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args, ...(modern ? { _meta: META } : {}) } });
  return (await handle(line)) as Record<string, unknown>;
}

// The parsed JSON text of a tool result, and whether it was an error.
async function tool(name: string, args: Record<string, unknown>, modern = false): Promise<{ body: Record<string, unknown>; isError: boolean }> {
  const reply = (await call(name, args, modern)) as { result?: { content: { text: string }[]; isError?: boolean } };
  expect(reply.result, JSON.stringify(reply)).toBeDefined();
  return { body: JSON.parse(reply.result?.content[0]?.text ?? '{}') as Record<string, unknown>, isError: reply.result?.isError === true };
}

async function errorCode(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { body, isError } = await tool(name, args);
  expect(isError).toBe(true);
  return (body.error as { code?: unknown } | undefined)?.code;
}

async function startRun(stopAt?: string): Promise<string> {
  const { body } = await tool('graph_start', { graph: 'demo', input: { idea: 'an idea' }, ...(stopAt === undefined ? {} : { stopAt }) });
  expect(typeof body.runId).toBe('string');
  return String(body.runId);
}

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), 'toto-graph-tools-'));
  mkdirSync(join(project, '.toto', 'graphs'), { recursive: true });
  writeFileSync(join(project, '.toto', 'graphs', 'demo.json'), JSON.stringify(GRAPH));
  writeFileSync(join(project, '.toto', 'graphs', 'broken.json'), JSON.stringify({ ...GRAPH, id: 'broken', edges: [...GRAPH.edges, ['build', 'spec']] }));
  writeFileSync(join(project, '.toto', 'graphs', 'notjson.json'), '{');
  handle = createServer(createTools(createRuntime({ TOTO_VAULT_PATH: join(project, 'vault'), HOME: project, CLAUDE_PROJECT_DIR: project })));
  live = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
});

afterAll(() => {
  live.kill();
  rmSync(project, { recursive: true, force: true });
});

describe('a full run through the tools', () => {
  it('lists valid and invalid user graphs', async () => {
    const { body } = await tool('graph_list', {});
    expect(body.graphs).toEqual([{ id: 'demo', nodes: 6, source: '.toto/graphs/demo.json' }]);
    expect(body.invalid).toEqual([
      { file: 'broken.json', error: 'cycle: spec -> pick -> rfc -> ok -> build -> spec' },
      { file: 'notjson.json', error: 'not valid JSON (SyntaxError)' },
    ]);
  });

  it('runs a graph to done, alternating eras, and logs every step', async () => {
    const runId = await startRun();
    expect((await tool('graph_next', { runId }, true)).body).toEqual({ runId, status: 'running', step: { nodeId: 'spec', kind: 'skill', skill: '/spec', instruction: 'scope it' } });
    await tool('graph_report', { runId, nodeId: 'spec', outcome: 'pass', evidence: 'brief written', artifacts: ['docs/brief.md'] });
    await tool('graph_report', { runId, nodeId: 'pick', outcome: 'pass', evidence: 'adr fits', choice: 'adr' }, true);
    const atGate = await tool('graph_report', { runId, nodeId: 'adr', outcome: 'pass', evidence: 'adr written' });
    expect(atGate.body).toMatchObject({ status: 'awaiting_approval', step: { nodeId: 'ok', kind: 'human_gate' } });
    await tool('graph_approve', { runId, nodeId: 'ok', decision: 'approve', note: 'user said yes' }, true);
    expect((await tool('graph_next', { runId })).body).toMatchObject({ step: { nodeId: 'build', kind: 'loop', iteration: 1 } });
    expect((await tool('graph_report', { runId, nodeId: 'build', outcome: 'pass', evidence: 'all stages pass' })).body).toEqual({ runId, status: 'done' });
    const status = (await tool('graph_status', { runId })).body;
    expect(status).toMatchObject({ status: 'done', current: null, nodes: { rfc: { state: 'skipped' }, pick: { state: 'done', choice: 'adr' } } });

    const dir = join(project, '.toto', 'runs', runId);
    const events = readFileSync(join(dir, 'events.jsonl'), 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    expect(events.map((e) => e.type)).toEqual(['start', 'report', 'report', 'skip', 'report', 'approve', 'report', 'done']);
    expect(events.find((e) => e.nodeId === 'spec')).toMatchObject({ evidence: 'brief written', artifacts: ['docs/brief.md'] });
    expect(events.find((e) => e.type === 'approve')).toMatchObject({ decision: 'approve', note: 'user said yes' });
    const state = readFileSync(join(dir, 'state.json'), 'utf8');
    // No evidence or note from any step, including the last, is in the state.
    for (const kept of ['brief written', 'adr fits', 'adr written', 'user said yes', 'all stages pass']) expect(state).not.toContain(kept);
    expect(JSON.parse(state)).toMatchObject({ eventSeq: events.length });
    expect(readFileSync(join(project, '.toto', 'runs', '.gitignore'), 'utf8')).toBe('*\n');
    expect(existsSync(join(dir, 'lock'))).toBe(false);
  });

  it('stops at the target and resumes', async () => {
    const runId = await startRun('spec');
    expect((await tool('graph_report', { runId, nodeId: 'spec', outcome: 'pass', evidence: 'e' })).body).toEqual({ runId, status: 'stopped_at_target' });
    expect((await tool('graph_next', { runId })).body).toEqual({ runId, status: 'stopped_at_target' });
    expect((await tool('graph_resume', { runId })).body).toMatchObject({ status: 'running', step: { nodeId: 'pick' } });
  });

  it('serves both templates with their headings', async () => {
    const { body } = await tool('graph_template', { kind: 'adr' }, true);
    expect(body.kind).toBe('adr');
    expect(String(body.markdown)).toContain('## Decision');
    expect(templateHeadings('rfc')).toEqual(['## Summary', '## Motivation', '## Design', '## Alternatives', '## Risks', '## Rollout', '## Open questions']);
    expect(templateHeadings('adr')).toEqual(['## Status', '## Context', '## Decision', '## Consequences']);
  });
});

describe('graph errors are { error: { code, message } } results', () => {
  it('reaches every #61 error code', async () => {
    expect(await errorCode('graph_start', { graph: 'nope', input: { idea: 'x' } })).toBe('UNKNOWN_GRAPH');
    expect(await errorCode('graph_start', { graph: 'broken', input: { idea: 'x' } })).toBe('INVALID_GRAPH');
    expect(await errorCode('graph_start', { graph: 'demo', input: { idea: 'x' }, stopAt: 'nope' })).toBe('UNKNOWN_NODE');
    expect(await errorCode('graph_next', { runId: '20990101-000000-abcdef' })).toBe('UNKNOWN_RUN');
    expect(await errorCode('graph_status', { runId: '../../etc' })).toBe('UNKNOWN_RUN');
    const runId = await startRun();
    expect(await errorCode('graph_report', { runId, nodeId: 'pick', outcome: 'pass', evidence: 'e' })).toBe('STALE_STEP');
    expect(await errorCode('graph_approve', { runId, nodeId: 'spec', decision: 'approve' })).toBe('NOT_A_GATE');
    await tool('graph_report', { runId, nodeId: 'spec', outcome: 'pass', evidence: 'e' });
    expect(await errorCode('graph_report', { runId, nodeId: 'pick', outcome: 'pass', evidence: 'e', choice: 'neither' })).toBe('INVALID_CHOICE');
    expect(await errorCode('graph_resume', { runId, stopAt: 'spec' })).toBe('UNKNOWN_NODE');
    writeFileSync(join(project, '.toto', 'runs', runId, 'lock'), `${String(live.pid)}\n`);
    expect(await errorCode('graph_next', { runId })).toBe('RUN_BUSY');
    expect(await errorCode('graph_report', { runId, nodeId: 'pick', outcome: 'pass', evidence: 'e', choice: 'rfc' })).toBe('RUN_BUSY');
    rmSync(join(project, '.toto', 'runs', runId, 'lock'));
    await tool('graph_report', { runId, nodeId: 'pick', outcome: 'fail', evidence: 'stuck' });
    expect(await errorCode('graph_resume', { runId })).toBe('RUN_FINISHED');
    expect(await errorCode('graph_report', { runId, nodeId: 'rfc', outcome: 'pass', evidence: 'e' })).toBe('RUN_FINISHED');
  });

  it('marks the result isError in the modern era too, with resultType', async () => {
    const reply = (await call('graph_next', { runId: '20990101-000000-abcdef' }, true)) as { result: Record<string, unknown> };
    expect(reply.result).toMatchObject({ isError: true, resultType: 'complete' });
  });

  it.each([
    ['graph_template', { kind: 'memo' }],
    ['graph_start', { graph: 'demo' }],
    ['graph_start', { graph: 'demo', input: { idea: '' } }],
    ['graph_start', { graph: 'demo', input: { idea: 'x'.repeat(4097) } }],
    ['graph_next', {}],
    ['graph_report', { runId: 'r', nodeId: 'n', outcome: 'maybe', evidence: 'e' }],
    ['graph_report', { runId: 'r', nodeId: 'n', outcome: 'pass' }],
    ['graph_report', { runId: 'r', nodeId: 'n', outcome: 'pass', evidence: 'x'.repeat(16385) }],
    ['graph_report', { runId: 'r', nodeId: 'n', outcome: 'pass', evidence: 'e', artifacts: [1] }],
    ['graph_approve', { runId: 'r', nodeId: 'n', decision: 'yes' }],
    ['graph_resume', { runId: 'r', stopAt: '' }],
  ])('%s %j is invalid input (-32602)', async (name, args) => {
    expect(await call(name, args)).toMatchObject({ error: { code: -32602 } });
  });
});

describe('the user graph folder', () => {
  it('means no graphs when missing, and a readable error when it cannot be read', async () => {
    const other = mkdtempSync(join(tmpdir(), 'toto-graphs-dir-'));
    try {
      expect(await loadUserGraphs(other)).toEqual({ graphs: [], invalid: [] });
      mkdirSync(join(other, '.toto'));
      writeFileSync(join(other, '.toto', 'graphs'), 'a file where the folder should be');
      await expect(loadUserGraphs(other)).rejects.toMatchObject({ code: -32603, message: expect.stringContaining('cannot read') as unknown });
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});

describe('spec criterion 12: no shipped auto-allow for graph_approve', () => {
  it('names graph_approve only in the server code and the README, never in a manifest, setting or skill', () => {
    const hits: string[] = [];
    const stack = [PLUGIN];
    while (stack.length > 0) {
      const dir = stack.pop() ?? '';
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) stack.push(path);
        else if (readFileSync(path, 'utf8').includes('graph_approve')) hits.push(relative(PLUGIN, path));
      }
    }
    expect(hits.length).toBeGreaterThan(0);
    // The README documents why gates are advisory; it grants nothing.
    expect(hits.filter((h) => !(h.startsWith('server/') && h.endsWith('.mts')) && h !== 'README.md')).toEqual([]);
    expect(JSON.stringify(JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8')))).not.toMatch(/"permissions"|"allow"/);
  });

  it('keeps run files inside the temp project (Arbiter condition 8)', () => {
    expect(existsSync(resolve(PLUGIN, '..', '.toto', 'runs'))).toBe(false);
  });
});
