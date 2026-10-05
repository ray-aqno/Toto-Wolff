// Boots the real plugin/server entry with `node` (type stripping, no build) and
// drives it over stdio with hostile input, checking every reply line.
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { TOOL_NAMES, isolatedEnv, removeIsolatedEnvs } from './spawn-env.ts';

const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../plugin/server');
const DEADLINE_MS = 20_000;

type Write = string | Buffer | { waitFor: string } | { pauseMs: number };
interface Run {
  code: number | null;
  lines: unknown[];
  stderr: string;
}

const req = (id: unknown, method: string, params?: unknown): string =>
  JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });

// Sends each write in order. { waitFor } pauses until stdout contains that text;
// { pauseMs } just waits, so the next write arrives as a separate read.
function runServer(entry: string, writes: readonly Write[]): Promise<Run> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [entry], { stdio: ['pipe', 'pipe', 'pipe'], env: isolatedEnv() });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')));
    const timer = setTimeout(() => {
      child.kill();
      fail(new Error(`server timed out; stdout so far: ${out.slice(0, 300)}`));
    }, DEADLINE_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      const lines = out.split('\n').filter((l) => l !== '');
      done({ code, lines: lines.map((l): unknown => JSON.parse(l)), stderr: err });
    });
    void (async (): Promise<void> => {
      for (const w of writes) {
        if (typeof w === 'object' && !Buffer.isBuffer(w) && 'pauseMs' in w) {
          await new Promise((r) => setTimeout(r, w.pauseMs));
          continue;
        }
        if (typeof w === 'object' && !Buffer.isBuffer(w)) {
          const until = Date.now() + DEADLINE_MS;
          while (!out.includes(w.waitFor) && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
          continue;
        }
        child.stdin.write(w);
      }
      child.stdin.end();
    })();
  });
}

const split = Buffer.from(`${req(13, 'tools/call', { name: 'café' })}\n`, 'utf8');
const splitAt = split.indexOf(Buffer.from('é')) + 1;

describe('plugin server over stdio (Node type stripping)', () => {
  afterAll(removeIsolatedEnvs);

  it('answers hostile input line by line and exits 0 at end of input', async () => {
    const run = await runServer(join(SERVER_DIR, 'index.mts'), [
      `${req(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {} })}\n`,
      `${req(2, 'initialize', { protocolVersion: '1999-01-01' })}\n`,
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
      `${req(3, 'tools/list')}\n`,
      `${req(4, 'tools/call', { name: 'nope' })}\n`,
      'this is not json\n',
      `${req(5, 'no/such/method')}\n`,
      `[${req(6, 'ping')}]\n`,
      `{"jsonrpc":"2.0","id":7,"method":"ping","params":{"pad":"${'a'.repeat(2 * 1024 * 1024)}"}}\n`,
      `${req(8, 'ping')}\n`,
      `${req(9, 'ping')}\r\n`,
      `${req(10, 'constructor')}\n`,
      `${req(null, 'ping')}\n`,
      '{"jsonrpc":"2.0","id":{},"method":"ping"}\n',
      Buffer.concat([Buffer.from('{"jsonrpc":"2.0","id":11,"method":"ping","params":{"x":"'), Buffer.from([0xff, 0xfe]), Buffer.from('"}}\n')]),
      { waitFor: 'Invalid request id' },
      split.subarray(0, splitAt),
      { pauseMs: 100 },
      split.subarray(splitAt),
      req(0, 'ping'),
    ]);
    const r = run.lines;
    expect(run.code).toBe(0);
    expect(r).toHaveLength(16);
    expect(r[0]).toMatchObject({ id: 1, result: { protocolVersion: '2025-11-25', serverInfo: { name: 'toto-wolff' } } });
    expect(r[1]).toMatchObject({ id: 2, result: { protocolVersion: '2025-11-25' } });
    expect(r[2]).toMatchObject({ id: 3, result: { tools: TOOL_NAMES.map((name) => ({ name })) } });
    expect(r[3]).toMatchObject({ id: 4, error: { code: -32602 } });
    expect(r[4]).toMatchObject({ id: null, error: { code: -32700 } });
    expect(r[5]).toMatchObject({ id: 5, error: { code: -32601 } });
    expect(r[6]).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batch requests are not supported' } });
    expect(r[7]).toMatchObject({ id: null, error: { code: -32600, message: 'Message exceeds 1048576 bytes' } });
    expect(r[8]).toEqual({ jsonrpc: '2.0', id: 8, result: {} });
    expect(r[9]).toEqual({ jsonrpc: '2.0', id: 9, result: {} });
    expect(r[10]).toMatchObject({ id: 10, error: { code: -32601 } });
    expect(r[11]).toEqual({ jsonrpc: '2.0', id: null, result: {} });
    expect(r[12]).toMatchObject({ id: null, error: { code: -32600, message: 'Invalid request id' } });
    expect(r[13]).toMatchObject({ id: null, error: { code: -32700, message: 'Parse error: message is not valid UTF-8' } });
    expect(r[14]).toMatchObject({ id: 13, error: { code: -32602, message: 'Unknown tool: café' } });
    expect(r[15]).toEqual({ jsonrpc: '2.0', id: 0, result: {} });
    expect(run.stderr).toBe('');
  }, DEADLINE_MS + 5_000);

  it('runs as an ES module under a parent package.json declaring commonjs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'toto-cjs-'));
    writeFileSync(join(root, 'package.json'), '{"type":"commonjs"}\n');
    cpSync(SERVER_DIR, join(root, 'server'), { recursive: true });
    const run = await runServer(join(root, 'server', 'index.mts'), [`${req(1, 'ping')}\n`]);
    expect(run.code).toBe(0);
    expect(run.lines).toEqual([{ jsonrpc: '2.0', id: 1, result: {} }]);
  }, DEADLINE_MS + 5_000);
});
