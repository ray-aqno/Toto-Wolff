// Run files and the lock (#61): project dir resolution, the runs folder and
// its .gitignore, atomic state writes, the event log, and the lock with
// stale-pid takeover (spec criterion 11).
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRun } from '../../plugin/server/graph/engine.mts';
import { acquireLock, assertNotBusy, assertStillHeld, isAlive, parsePid, releaseLock, withRunLock } from '../../plugin/server/graph/lock.mts';
import { MAX_STATE_BYTES, appendEvents, ensureRunsDir, newRunId, readState, resolveProjectDir, runDir, writeState } from '../../plugin/server/graph/store.mts';
import { parseGraph } from '../../plugin/server/graph/validate.mts';

const GRAPH = parseGraph({ id: 'g', version: 1, nodes: [{ id: 'a', kind: 'skill', skill: '/a', instruction: 'a' }], edges: [] });
let project: string;
let live: ChildProcess;
let deadPid: number;

beforeAll(() => {
  live = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  // A process that has already exited: its pid answers ESRCH.
  deadPid = Number(spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout);
});

afterAll(() => {
  live.kill();
});

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'toto-store-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(project, { recursive: true, force: true });
});

async function newRun(): Promise<{ dir: string; runId: string }> {
  await ensureRunsDir(project);
  const runId = newRunId(new Date('2026-10-05T01:02:03Z'));
  const dir = runDir(project, runId);
  mkdirSync(dir);
  await writeState(project, createRun(GRAPH, runId, 'idea', null, 'now').state);
  return { dir, runId };
}

describe('paths', () => {
  it('uses CLAUDE_PROJECT_DIR only when it is absolute (Safety Car S7)', () => {
    expect(resolveProjectDir({ CLAUDE_PROJECT_DIR: '/p' }, '/cwd')).toBe('/p');
    expect(resolveProjectDir({ CLAUDE_PROJECT_DIR: 'rel' }, '/cwd')).toBe('/cwd');
    expect(resolveProjectDir({}, '/cwd')).toBe('/cwd');
  });

  it('makes run ids YYYYMMDD-HHMMSS-<6 hex>', () => {
    expect(newRunId(new Date('2026-10-05T01:02:03Z'))).toMatch(/^20261005-010203-[0-9a-f]{6}$/);
  });

  it.each([['../x'], ['20261005-010203-zzzzzz'], [''], ['20261005-010203-abcdef/..']])('rejects run id %j before building any path', (runId) => {
    expect(() => runDir(project, runId)).toThrow(expect.objectContaining({ code: 'UNKNOWN_RUN' }) as Error);
  });

  it('gives .toto/runs its own .gitignore and never touches the project one', async () => {
    writeFileSync(join(project, '.gitignore'), 'node_modules\n');
    await ensureRunsDir(project);
    await ensureRunsDir(project);
    expect(readFileSync(join(project, '.toto', 'runs', '.gitignore'), 'utf8')).toBe('*\n');
    expect(readFileSync(join(project, '.gitignore'), 'utf8')).toBe('node_modules\n');
  });
});

describe('state.json', () => {
  it('round-trips a state, with prototype-free node records', async () => {
    const { runId } = await newRun();
    const state = await readState(project, runId);
    expect(state).toMatchObject({ runId, status: 'running', current: 'a' });
    expect(Object.getPrototypeOf(state.nodes)).toBeNull();
  });

  it('replaces state.json by rename (a new file), never rewriting it in place', async () => {
    const { dir, runId } = await newRun();
    const before = statSync(join(dir, 'state.json')).ino;
    await writeState(project, { ...(await readState(project, runId)), updatedAt: 'later' });
    expect(statSync(join(dir, 'state.json')).ino).not.toBe(before);
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('ignores a stray temp file left by a killed write', async () => {
    const { dir, runId } = await newRun();
    writeFileSync(join(dir, 'state.json.999.tmp'), '{"torn');
    expect((await readState(project, runId)).runId).toBe(runId);
  });

  it('treats a run folder without state.json as UNKNOWN_RUN (Safety Car S18)', async () => {
    await ensureRunsDir(project);
    const runId = newRunId(new Date());
    mkdirSync(runDir(project, runId));
    await expect(readState(project, runId)).rejects.toMatchObject({ code: 'UNKNOWN_RUN' });
  });

  it.each([
    ['not JSON', '{"torn'],
    ['an own __proto__ key in nodes', null],
    ['the wrong run id', 'wrong-id'],
  ])('reports a corrupt state (%s) as a readable internal error', async (_name, kind) => {
    const { dir, runId } = await newRun();
    const good = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) as Record<string, unknown>;
    const text = kind === '{"torn' ? kind : kind === null ? JSON.stringify(good).replace('"nodes":{', '"nodes":{"__proto__":{"state":"done"},') : JSON.stringify({ ...good, runId: kind });
    writeFileSync(join(dir, 'state.json'), text);
    await expect(readState(project, runId)).rejects.toMatchObject({ code: -32603, message: expect.stringContaining('not a valid run state') as unknown });
  });

  it('refuses to read a state.json over the cap', async () => {
    const { dir, runId } = await newRun();
    writeFileSync(join(dir, 'state.json'), ' '.repeat(MAX_STATE_BYTES + 1));
    await expect(readState(project, runId)).rejects.toMatchObject({ code: -32603, message: expect.stringContaining('over the') as unknown });
  });
});

describe('events.jsonl', () => {
  it('appends numbered events and starts a fresh line after a partial one (Safety Car S6)', async () => {
    const { dir, runId } = await newRun();
    await appendEvents(project, runId, [{ type: 'start' }], 1, 't1');
    writeFileSync(join(dir, 'events.jsonl'), `${readFileSync(join(dir, 'events.jsonl'), 'utf8')}{"seq":2,"tor`);
    await appendEvents(project, runId, [{ type: 'report', nodeId: 'a', outcome: 'pass' }, { type: 'done' }], 3, 't2');
    const lines = readFileSync(join(dir, 'events.jsonl'), 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(4);
    expect(JSON.parse(lines[0] ?? '')).toEqual({ seq: 1, at: 't1', type: 'start' });
    expect(lines[1]).toBe('{"seq":2,"tor');
    expect(JSON.parse(lines[3] ?? '')).toEqual({ seq: 4, at: 't2', type: 'done' });
  });
});

describe('the lock', () => {
  it('reads pids strictly (Arbiter condition 1)', () => {
    expect(parsePid('123\n')).toBe(123);
    for (const bad of ['', '0', '-1', 'abc', '12 34', '1e3', '99999999999']) expect(parsePid(bad)).toBeNull();
  });

  it('tells a live pid from a dead one', () => {
    expect(isAlive(live.pid ?? 0)).toBe(true);
    expect(deadPid).toBeGreaterThan(0);
    expect(isAlive(deadPid)).toBe(false);
  });

  it('is never visible empty and leaves no temp file', async () => {
    const { dir, runId } = await newRun();
    await acquireLock(dir, runId);
    expect(readFileSync(join(dir, 'lock'), 'utf8')).toBe(`${String(process.pid)}\n`);
    expect(readdirSync(dir).filter((f) => f.startsWith('lock.'))).toEqual([]);
    await releaseLock(dir);
    expect(existsSync(join(dir, 'lock'))).toBe(false);
  });

  it('gives RUN_BUSY while a live process holds it, for state changes and graph_next alike', async () => {
    const { dir, runId } = await newRun();
    writeFileSync(join(dir, 'lock'), `${String(live.pid)}\n`);
    await expect(acquireLock(dir, runId)).rejects.toMatchObject({ code: 'RUN_BUSY', message: expect.stringContaining(String(live.pid)) as unknown });
    await expect(assertNotBusy(dir, runId)).rejects.toMatchObject({ code: 'RUN_BUSY' });
    expect(readFileSync(join(dir, 'lock'), 'utf8')).toBe(`${String(live.pid)}\n`);
  });

  it('takes over a lock whose pid is dead', async () => {
    const { dir, runId } = await newRun();
    writeFileSync(join(dir, 'lock'), `${String(deadPid)}\n`);
    await assertNotBusy(dir, runId);
    expect(readFileSync(join(dir, 'lock'), 'utf8')).toBe(`${String(deadPid)}\n`);
    await acquireLock(dir, runId);
    expect(readFileSync(join(dir, 'lock'), 'utf8')).toBe(`${String(process.pid)}\n`);
  });

  it('takes over its own leftover lock (Arbiter condition 3)', async () => {
    const { dir, runId } = await newRun();
    writeFileSync(join(dir, 'lock'), `${String(process.pid)}\n`);
    await expect(withRunLock(dir, runId, () => Promise.resolve('ran'))).resolves.toBe('ran');
    expect(existsSync(join(dir, 'lock'))).toBe(false);
  });

  it.each([[''], ['garbage'], ['0']])('never takes over an unreadable lock (%j): RUN_BUSY (Arbiter condition 2)', async (text) => {
    const { dir, runId } = await newRun();
    writeFileSync(join(dir, 'lock'), text);
    await expect(acquireLock(dir, runId)).rejects.toMatchObject({ code: 'RUN_BUSY', message: expect.stringContaining('unreadable') as unknown });
    expect(readFileSync(join(dir, 'lock'), 'utf8')).toBe(text);
  });

  it('is not blocked by a leftover temp file (Safety Car S2), and releases on failure', async () => {
    const { dir, runId } = await newRun();
    writeFileSync(join(dir, `lock.${String(process.pid)}.tmp`), 'old');
    await expect(withRunLock(dir, runId, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(existsSync(join(dir, 'lock'))).toBe(false);
  });

  it('notices a lock taken over by another process before writing (PR #73 review)', async () => {
    const { dir, runId } = await newRun();
    await acquireLock(dir, runId);
    await expect(assertStillHeld(dir, runId)).resolves.toBeUndefined();
    writeFileSync(join(dir, 'lock'), `${String(live.pid)}\n`);
    await expect(assertStillHeld(dir, runId)).rejects.toMatchObject({ code: 'RUN_BUSY', message: expect.stringContaining('took over its lock') as unknown });
    rmSync(join(dir, 'lock'));
    await expect(assertStillHeld(dir, runId)).rejects.toMatchObject({ code: 'RUN_BUSY' });
  });

  it('leaves a lock taken by another live process in place on release', async () => {
    const { dir } = await newRun();
    writeFileSync(join(dir, 'lock'), `${String(live.pid)}\n`);
    await releaseLock(dir);
    expect(readFileSync(join(dir, 'lock'), 'utf8')).toBe(`${String(live.pid)}\n`);
  });
});
