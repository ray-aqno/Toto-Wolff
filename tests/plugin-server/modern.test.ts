// MCP 2026-07-28 (stateless era) and how requests are routed between eras.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createServer } from '../../plugin/server/mcp/server.mts';
import type { LineHandler, Tool } from '../../plugin/server/mcp/server.mts';
import { DEFINITIONS } from '../../plugin/server/tools/index.mts';
import { isolatedEnv, removeIsolatedEnvs, serverEnv } from './spawn-env.ts';

const ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), '../../plugin/server/index.mts');
const VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';
const CAPS_KEY = 'io.modelcontextprotocol/clientCapabilities';
const SERVER_INFO = { 'io.modelcontextprotocol/serverInfo': { name: 'toto-wolff', version: '2.0.0' } };
const META = { [VERSION_KEY]: '2026-07-28', [CAPS_KEY]: {} };

const echo: Tool = {
  definition: { name: 'echo', description: 'echo tool', inputSchema: { type: 'object' } },
  handler: (args) => ({ content: [{ type: 'text', text: String(args.text) }] }),
};
const req = (method: string, params?: unknown, id: unknown = 1): string =>
  JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
const modern = (method: string, extra: Record<string, unknown> = {}, meta: unknown = META): string =>
  req(method, { ...extra, _meta: meta });
const serve = (tools: Tool[] = [echo]): LineHandler => createServer(tools);

describe('server/discover', () => {
  it('advertises 2026-07-28, the tools capability, caching hints and the server identity', async () => {
    expect(await serve()(modern('server/discover'))).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        supportedVersions: ['2026-07-28'],
        capabilities: { tools: {} },
        ttlMs: 300000,
        cacheScope: 'public',
        resultType: 'complete',
        _meta: SERVER_INFO,
      },
    });
  });

  it('answers identically on every call (no reply alters another)', async () => {
    const handle = serve();
    const first = await handle(modern('server/discover'));
    const second = await handle(modern('server/discover'));
    expect(second).toEqual(first);
  });
});

describe('modern tools/list and tools/call', () => {
  it('lists every tool in one page with resultType, caching hints and serverInfo', async () => {
    expect(await serve()(modern('tools/list'))).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { tools: [echo.definition], ttlMs: 300000, cacheScope: 'public', resultType: 'complete', _meta: SERVER_INFO },
    });
  });

  it.each([[''], [null], ['abc']])('rejects any cursor (%j): the server never issues one', async (cursor) => {
    expect(await serve()(modern('tools/list', { cursor }))).toMatchObject({ id: 1, error: { code: -32602, message: 'Invalid cursor' } });
  });

  it('wraps a tool result with resultType and serverInfo', async () => {
    expect(await serve()(modern('tools/call', { name: 'echo', arguments: { text: 'hi' } }))).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { content: [{ type: 'text', text: 'hi' }], resultType: 'complete', _meta: SERVER_INFO },
    });
  });

  it("keeps a handler's own _meta keys and resultType, and accepts a frozen result", async () => {
    const custom: Tool = {
      definition: { name: 'custom', description: 'custom', inputSchema: { type: 'object' } },
      handler: () => Object.freeze({ content: [], resultType: 'complete', _meta: Object.freeze({ 'com.example/trace': 't1' }) }),
    };
    const handle = serve([custom]);
    const call = modern('tools/call', { name: 'custom', arguments: {} });
    const first = await handle(call);
    expect(first).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { content: [], resultType: 'complete', _meta: { 'com.example/trace': 't1', ...SERVER_INFO } },
    });
    expect(await handle(call)).toEqual(first);
  });

  it("maps a handler's non-object _meta to an internal error", async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const bad: Tool = {
      definition: { name: 'bad', description: 'bad', inputSchema: { type: 'object' } },
      handler: () => ({ content: [], _meta: 'oops' }),
    };
    expect(await serve([bad])(modern('tools/call', { name: 'bad', arguments: {} }))).toMatchObject({ error: { code: -32603 } });
    vi.restoreAllMocks();
  });

  it('answers ping and initialize with -32601: 2026-07-28 has neither', async () => {
    const handle = serve();
    expect(await handle(modern('ping'))).toMatchObject({ error: { code: -32601 } });
    expect(await handle(modern('initialize', { protocolVersion: '2025-11-25' }))).toMatchObject({ error: { code: -32601 } });
  });
});

describe('_meta validation', () => {
  it.each([
    ['version missing (only capabilities)', { [CAPS_KEY]: {} }, VERSION_KEY],
    ['version null', { [VERSION_KEY]: null, [CAPS_KEY]: {} }, VERSION_KEY],
    ['version a number', { [VERSION_KEY]: 0, [CAPS_KEY]: {} }, VERSION_KEY],
    ['version false', { [VERSION_KEY]: false, [CAPS_KEY]: {} }, VERSION_KEY],
    ['capabilities missing (only version)', { [VERSION_KEY]: '2026-07-28' }, CAPS_KEY],
    ['capabilities an array', { [VERSION_KEY]: '2026-07-28', [CAPS_KEY]: [] }, CAPS_KEY],
    ['capabilities null', { [VERSION_KEY]: '2026-07-28', [CAPS_KEY]: null }, CAPS_KEY],
    ['capabilities a string', { [VERSION_KEY]: '2026-07-28', [CAPS_KEY]: 'x' }, CAPS_KEY],
    ['capabilities a number', { [VERSION_KEY]: '2026-07-28', [CAPS_KEY]: 1 }, CAPS_KEY],
  ])('%s -> -32602 naming the field', async (_name, meta, field) => {
    const reply = await serve()(modern('tools/list', {}, meta));
    expect(reply).toEqual({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: expect.stringContaining(field) as unknown } });
  });

  it('checks field presence before the version: a bad version with missing capabilities is -32602', async () => {
    expect(await serve()(modern('tools/list', {}, { [VERSION_KEY]: '1999-01-01' }))).toMatchObject({ error: { code: -32602 } });
  });

  it.each([['2025-11-25'], ['1999-01-01'], ['']])('an unsupported version (%j) -> -32022 with the supported list', async (version) => {
    const reply = await serve()(modern('server/discover', {}, { [VERSION_KEY]: version, [CAPS_KEY]: {} }));
    expect(reply).toEqual({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32022, message: 'Unsupported protocol version', data: { supported: ['2026-07-28'], requested: version } },
    });
  });

  it('cuts an echoed version to 128 bytes', async () => {
    const reply = await serve()(modern('server/discover', {}, { [VERSION_KEY]: 'v'.repeat(1024 * 1024), [CAPS_KEY]: {} }));
    expect(reply).toMatchObject({ error: { code: -32022, data: { requested: 'v'.repeat(128) } } });
  });

  it('accepts an empty capabilities object and ignores extra _meta keys', async () => {
    const meta = { ...META, 'io.modelcontextprotocol/clientInfo': { name: 'c', version: '1' }, progressToken: 'p' };
    expect(await serve()(modern('tools/list', {}, meta))).toMatchObject({ result: { resultType: 'complete' } });
  });

  it('rejects a null id on the modern path only', async () => {
    const handle = serve();
    expect(await handle(req('tools/list', { _meta: META }, null))).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Request id must not be null' },
    });
    expect(await handle(req('ping', undefined, null))).toEqual({ jsonrpc: '2.0', id: null, result: {} });
  });
});

describe('era routing', () => {
  it.each([
    ['no _meta', undefined],
    ['_meta a string', 'x'],
    ['_meta an array', [META]],
    ['_meta with progressToken only', { progressToken: 'p' }],
    ['_meta with clientInfo only', { 'io.modelcontextprotocol/clientInfo': { name: 'c', version: '1' } }],
    ['_meta with logLevel only', { 'io.modelcontextprotocol/logLevel': 'info' }],
    ['_meta with traceparent only', { traceparent: '00-0af7651916cd43dd8448eb211c80319c-00f067aa0ba902b7-01' }],
  ])('%s is served by the legacy path', async (_name, meta) => {
    const params = meta === undefined ? undefined : { _meta: meta };
    expect(await serve()(req('tools/list', params))).toEqual({ jsonrpc: '2.0', id: 1, result: { tools: [echo.definition] } });
  });

  it('serves both eras on one connection, keeping no state between requests', async () => {
    const handle = serve();
    expect(await handle(req('initialize', { protocolVersion: '2025-11-25' }))).toMatchObject({ result: { protocolVersion: '2025-11-25' } });
    expect(await handle(modern('server/discover'))).toMatchObject({ result: { resultType: 'complete' } });
    expect(await handle(req('tools/list'))).toEqual({ jsonrpc: '2.0', id: 1, result: { tools: [echo.definition] } });
    expect(await handle(modern('tools/list'))).toMatchObject({ result: { resultType: 'complete', ttlMs: 300000 } });
  });

  it('answers notifications with nothing in either era', async () => {
    const handle = serve();
    const cancelled = { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } };
    expect(await handle(JSON.stringify(cancelled))).toBeNull();
    expect(await handle(JSON.stringify({ ...cancelled, params: { requestId: 1, _meta: META } }))).toBeNull();
  });
});

describe('the real entry serves both eras over stdio', () => {
  afterAll(removeIsolatedEnvs);

  it('answers a modern discover and tools/list, then a legacy initialize', () => {
    const input = [
      modern('server/discover', {}, META),
      req('tools/list', { _meta: META }, 2),
      req('initialize', { protocolVersion: '2025-11-25' }, 3),
    ].join('\n');
    const run = spawnSync(process.execPath, [ENTRY], { input: `${input}\n`, encoding: 'utf8', timeout: 20_000, env: isolatedEnv(serverEnv()) });
    expect(run.status).toBe(0);
    expect(run.stderr).toBe('');
    const replies = run.stdout.trim().split('\n').map((line): unknown => JSON.parse(line));
    expect(replies).toEqual([
      { jsonrpc: '2.0', id: 1, result: expect.objectContaining({ supportedVersions: ['2026-07-28'], resultType: 'complete' }) as unknown },
      { jsonrpc: '2.0', id: 2, result: { tools: Object.values(DEFINITIONS), ttlMs: 300000, cacheScope: 'public', resultType: 'complete', _meta: SERVER_INFO } },
      { jsonrpc: '2.0', id: 3, result: expect.objectContaining({ protocolVersion: '2025-11-25' }) as unknown },
    ]);
  });
});
