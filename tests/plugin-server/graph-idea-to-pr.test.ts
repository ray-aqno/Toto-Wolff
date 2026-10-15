// Spec criterion 5, through the real tools on a temp copy of a fixture
// project. This is a tool-level proof (Safety Car S8): the test plays the
// driver's part (it writes each document at the step's doc.path and reports
// fixed evidence); a manual run of the real graph-run skill is recorded in
// the PR.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createLineHandler } from '../../plugin/server/mcp/server.mts';
import type { LineHandler } from '../../plugin/server/mcp/server.mts';
import { createRuntime } from '../../plugin/server/runtime.mts';
import { createTools } from '../../plugin/server/tools/index.mts';
import { templateFor } from '../../plugin/server/graph/templates.mts';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures');
const PR = 'https://github.com/ray-aqno/Toto-Wolff/pull/999';
const projects: string[] = [];
let nextId = 0;

interface Step { nodeId: string; kind: string; iteration?: number; doc?: { path?: string; error?: string } }
interface Reply { status: string; runId: string; step?: Step; error?: { code: string; message: string } }

function project(fixture: string): { dir: string; handle: LineHandler } {
  const dir = mkdtempSync(join(tmpdir(), 'toto-idea-to-pr-'));
  projects.push(dir);
  cpSync(join(FIXTURES, fixture), dir, { recursive: true });
  return { dir, handle: createLineHandler(createTools(createRuntime({ vault: join(dir, '.vault'), project: dir }))) };
}

async function call(handle: LineHandler, name: string, args: Record<string, unknown>): Promise<Reply> {
  const reply = (await handle(JSON.stringify({ jsonrpc: '2.0', id: ++nextId, method: 'tools/call', params: { name, arguments: args } }))) as { result: { content: { text: string }[] } };
  return JSON.parse(reply.result.content[0]?.text ?? '{}') as Reply;
}

// Plays the driver until the run leaves `running` / `awaiting_approval`:
// passes every step, picks `kind`, writes the document, approves the gates.
async function drive(dir: string, handle: LineHandler, start: Reply, kind: 'rfc' | 'adr'): Promise<{ last: Reply; approvals: number }> {
  let r = start;
  let approvals = 0;
  for (let guard = 0; guard < 20 && r.step !== undefined; guard++) {
    const { nodeId, kind: nodeKind } = r.step;
    const base = { runId: r.runId, nodeId };
    if (nodeKind === 'human_gate') {
      approvals++;
      r = await call(handle, 'graph_approve', { ...base, decision: 'approve', note: 'yes (the person)' });
    } else if (nodeKind === 'choice') {
      r = await call(handle, 'graph_report', { ...base, outcome: 'pass', evidence: `the person chose ${kind}`, choice: kind });
    } else if (r.step.doc !== undefined) {
      const path = r.step.doc.path;
      expect(path, JSON.stringify(r.step.doc)).toBeDefined();
      mkdirSync(join(dir, dirname(path ?? '')), { recursive: true });
      writeFileSync(join(dir, path ?? ''), templateFor(kind));
      r = await call(handle, 'graph_report', { ...base, outcome: 'pass', evidence: 'written', artifacts: [path] });
    } else {
      const evidence = nodeId === 'pr' ? PR : `${nodeId} done`;
      r = await call(handle, 'graph_report', { ...base, outcome: 'pass', evidence, ...(r.step.iteration === undefined ? {} : { iteration: r.step.iteration }) });
    }
    expect(r.error, JSON.stringify(r.error)).toBeUndefined();
  }
  return { last: r, approvals };
}

const approveEvents = (dir: string, runId: string): number =>
  readFileSync(join(dir, '.toto', 'runs', runId, 'events.jsonl'), 'utf8').trimEnd().split('\n').filter((l) => (JSON.parse(l) as { type: string }).type === 'approve').length;

afterEach(() => {
  for (const dir of projects.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('spec criterion 5 on tests/fixtures/graph-project', () => {
  it('stopAt karpathy: stopped_at_target, docs/adr/0001-<slug>.md, exactly 2 gates; then a second run to done with 3', async () => {
    const { dir, handle } = project('graph-project');
    const first = await call(handle, 'graph_start', { graph: 'idea-to-pr', input: { idea: 'Faster builds' }, stopAt: 'karpathy' });
    const a = await drive(dir, handle, first, 'adr');
    expect(a.last.status).toBe('stopped_at_target');
    expect(a.approvals).toBe(2);
    expect(approveEvents(dir, first.runId)).toBe(2);
    expect(existsSync(join(dir, 'docs', 'adr', '0001-faster-builds.md'))).toBe(true);

    const second = await call(handle, 'graph_start', { graph: 'idea-to-pr', input: { idea: 'Cache the lint results' } });
    const b = await drive(dir, handle, second, 'adr');
    expect(b.last.status).toBe('done');
    expect(b.approvals).toBe(3);
    expect(approveEvents(dir, second.runId)).toBe(3);
    expect(existsSync(join(dir, 'docs', 'adr', '0002-cache-the-lint-results.md'))).toBe(true);
  });

  it('works the same with an RFC', async () => {
    const { dir, handle } = project('graph-project');
    const r = await call(handle, 'graph_start', { graph: 'idea-to-pr', input: { idea: 'Plugin marketplace' }, stopAt: 'karpathy' });
    expect((await drive(dir, handle, r, 'rfc')).last.status).toBe('stopped_at_target');
    expect(existsSync(join(dir, 'docs', 'rfc', '0001-plugin-marketplace.md'))).toBe(true);
  });
});

describe('a project with no docs/ folder (tests/fixtures/graph-project-bare, Safety Car S2)', () => {
  it('starts its document at 0001', async () => {
    const { dir, handle } = project('graph-project-bare');
    const r = await call(handle, 'graph_start', { graph: 'idea-to-pr', input: { idea: 'Faster builds' }, stopAt: 'adr' });
    expect((await drive(dir, handle, r, 'adr')).last.status).toBe('stopped_at_target');
    expect(existsSync(join(dir, 'docs', 'adr', '0001-faster-builds.md'))).toBe(true);
  });
});

describe('where the checks run (Arbiter condition 1)', () => {
  it('rejects a document that is not there, accepts it once written, and never re-checks a done step', async () => {
    const { dir, handle } = project('graph-project');
    const start = await call(handle, 'graph_start', { graph: 'idea-to-pr', input: { idea: 'Faster builds' }, stopAt: 'kind' });
    expect((await drive(dir, handle, start, 'adr')).last.status).toBe('stopped_at_target');
    const r = await call(handle, 'graph_resume', { runId: start.runId });
    expect(r.step).toMatchObject({ nodeId: 'adr', doc: { path: 'docs/adr/0001-faster-builds.md' } });
    const report = (evidence: string): Promise<Reply> => call(handle, 'graph_report', { runId: r.runId, nodeId: 'adr', outcome: 'pass', evidence, artifacts: ['docs/adr/0001-faster-builds.md'] });
    expect((await report('not written yet')).error).toMatchObject({ code: 'BAD_EVIDENCE', message: expect.stringContaining('cannot be read') as unknown });
    writeFileSync(join(dir, 'docs', 'adr', '0001-faster-builds.md'), templateFor('adr'));
    expect((await report('written')).step?.nodeId).toBe('p10');
    // The adr step is done: a repeated report is a no-op and is not re-checked,
    // even though the file is gone now.
    rmSync(join(dir, 'docs', 'adr', '0001-faster-builds.md'));
    const again = await report('retry');
    expect(again.error).toBeUndefined();
    expect(again.step?.nodeId).toBe('p10');
  });

  it('refuses a pr step whose evidence is not a bare PR URL, but lets a fail through', async () => {
    const { dir, handle } = project('graph-project');
    const start = await call(handle, 'graph_start', { graph: 'idea-to-pr', input: { idea: 'Ship it' }, stopAt: 'approve-pr' });
    const at = await drive(dir, handle, start, 'adr');
    expect(at.last.status).toBe('stopped_at_target');
    const r = await call(handle, 'graph_resume', { runId: start.runId });
    expect(r.step?.nodeId).toBe('pr');
    expect((await call(handle, 'graph_report', { runId: r.runId, nodeId: 'pr', outcome: 'pass', evidence: 'opened the PR' })).error).toMatchObject({ code: 'BAD_EVIDENCE' });
    expect((await call(handle, 'graph_report', { runId: r.runId, nodeId: 'pr', outcome: 'fail', evidence: 'could not push' })).status).toBe('failed');
  });
});
