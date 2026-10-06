// Real server processes (#61): kill mid-step and resume in a new process
// (spec criterion 6), a lost event append leaves a seq gap, never a
// duplicate (Arbiter condition 7), and the run lock across processes
// (criterion 11), including a lock left by a killed server.
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { isolatedEnv, removeIsolatedEnvs, serverEnv } from './spawn-env.ts';

const ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), '../../plugin/server/index.mts');
const GRAPH = {
  id: 'line',
  version: 1,
  nodes: ['a', 'b', 'c'].map((id) => ({ id, kind: 'skill', skill: `/${id}`, instruction: `do ${id}` })),
  edges: [['a', 'b'], ['b', 'c']],
};

let project: string;

// One server process, driven line by line.
class Server {
  readonly child: ChildProcessWithoutNullStreams;
  private out = '';
  private id = 0;

  constructor() {
    this.child = spawn(process.execPath, [ENTRY], { env: isolatedEnv(serverEnv({ project })) });
    this.child.stdout.on('data', (d: Buffer) => (this.out += d.toString('utf8')));
  }

  async call(name: string, args: Record<string, unknown>): Promise<{ body: Record<string, unknown>; isError: boolean }> {
    const id = ++this.id;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })}\n`);
    const line = await vi.waitFor(() => {
      const found = this.out.split('\n').find((l) => l.startsWith(`{"jsonrpc":"2.0","id":${String(id)},`));
      if (found === undefined) throw new Error(`no reply to ${String(id)} yet`);
      return found;
    }, { timeout: 10_000, interval: 20 });
    const reply = JSON.parse(line) as { result: { content: { text: string }[]; isError?: boolean } };
    return { body: JSON.parse(reply.result.content[0]?.text ?? '{}') as Record<string, unknown>, isError: reply.result.isError === true };
  }

  kill(): Promise<void> {
    return new Promise((done) => {
      this.child.on('exit', () => done());
      this.child.kill('SIGKILL');
    });
  }
}

const eventsOf = (runId: string): Record<string, unknown>[] =>
  readFileSync(join(project, '.toto', 'runs', runId, 'events.jsonl'), 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), 'toto-graph-crash-'));
  mkdirSync(join(project, '.toto', 'graphs'), { recursive: true });
  writeFileSync(join(project, '.toto', 'graphs', 'line.json'), JSON.stringify(GRAPH));
});

afterAll(() => {
  rmSync(project, { recursive: true, force: true });
  removeIsolatedEnvs();
});

describe('spec criterion 6: kill mid-step, resume in a new process', () => {
  it('returns the same in-flight step and never repeats a completed one', async () => {
    const first = new Server();
    const runId = String((await first.call('graph_start', { graph: 'line', input: { idea: 'i' } })).body.runId);
    await first.call('graph_report', { runId, nodeId: 'a', outcome: 'pass', evidence: 'a done' });
    expect((await first.call('graph_next', { runId })).body).toMatchObject({ step: { nodeId: 'b' } });
    await first.kill();

    const second = new Server();
    expect((await second.call('graph_resume', { runId })).body).toEqual({ runId, status: 'running', step: { nodeId: 'b', kind: 'skill', skill: '/b', instruction: 'do b' } });
    expect((await second.call('graph_report', { runId, nodeId: 'a', outcome: 'pass', evidence: 'retry' })).body).toMatchObject({ step: { nodeId: 'b' } });
    await second.call('graph_report', { runId, nodeId: 'b', outcome: 'pass', evidence: 'b done' });
    expect((await second.call('graph_status', { runId })).body).toMatchObject({ current: 'c', nodes: { a: { state: 'done' }, b: { state: 'done' }, c: { state: 'pending' } } });
    expect(eventsOf(runId).filter((e) => e.type === 'report' && e.nodeId === 'a')).toHaveLength(1);
    await second.kill();
  });
});

describe('Arbiter condition 7: a lost event append', () => {
  it('leaves a gap in seq, never a duplicate, and the run goes on', async () => {
    const server = new Server();
    const runId = String((await server.call('graph_start', { graph: 'line', input: { idea: 'i' } })).body.runId);
    await server.call('graph_report', { runId, nodeId: 'a', outcome: 'pass', evidence: 'a' });
    // As if the server died after writing state.json but before appending.
    const file = join(project, '.toto', 'runs', runId, 'events.jsonl');
    const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
    writeFileSync(file, `${lines.slice(0, -1).join('\n')}\n`);
    await server.call('graph_report', { runId, nodeId: 'b', outcome: 'pass', evidence: 'b' });
    const seqs = eventsOf(runId).map((e) => Number(e.seq));
    expect(seqs).toEqual([1, 3]);
    expect(new Set(seqs).size).toBe(seqs.length);
    await server.kill();
  });
});

describe('spec criterion 11: the lock across processes', () => {
  it('a live server holding the lock makes another return RUN_BUSY; a killed holder is taken over', async () => {
    const holder = new Server();
    const other = new Server();
    const runId = String((await other.call('graph_start', { graph: 'line', input: { idea: 'i' } })).body.runId);
    const lock = join(project, '.toto', 'runs', runId, 'lock');
    // The holder's pid in the lock, as if it were mid-call.
    writeFileSync(lock, `${String(holder.child.pid)}\n`);
    for (const [name, args] of [['graph_next', { runId }], ['graph_report', { runId, nodeId: 'a', outcome: 'pass', evidence: 'e' }], ['graph_resume', { runId }]] as const) {
      const r = await other.call(name, args);
      expect(r.isError, name).toBe(true);
      expect(r.body).toMatchObject({ error: { code: 'RUN_BUSY' } });
    }
    expect((await other.call('graph_status', { runId })).isError).toBe(false);
    await holder.kill();
    expect((await other.call('graph_report', { runId, nodeId: 'a', outcome: 'pass', evidence: 'e' })).body).toMatchObject({ step: { nodeId: 'b' } });
    await other.kill();
  });
});
