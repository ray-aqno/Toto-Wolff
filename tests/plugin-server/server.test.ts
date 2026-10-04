import { afterEach, describe, expect, it, vi } from 'vitest';
import { INTERNAL_ERROR, INVALID_PARAMS, METHOD_NOT_FOUND, RpcError, toolError } from '../../plugin/server/mcp/protocol.mts';
import { MAX_RESULT_BYTES, MAX_TOOLS, createServer } from '../../plugin/server/mcp/server.mts';
import type { Tool } from '../../plugin/server/mcp/server.mts';

function tool(name: string, handler: Tool['handler']): Tool {
  return { definition: { name, description: `${name} tool`, inputSchema: { type: 'object' } }, handler };
}

const echo = tool('echo', (args) => ({ content: [{ type: 'text', text: String(args.text) }] }));
const call = (name: string, args?: unknown): string =>
  JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('built-in methods', () => {
  const handle = createServer([echo]);

  it('negotiates a supported protocol version and falls back to the latest', async () => {
    const supported = await handle('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}');
    const unknown = await handle('{"jsonrpc":"2.0","id":2,"method":"initialize","params":{"protocolVersion":"1999-01-01"}}');
    expect(supported).toMatchObject({ id: 1, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} } } });
    expect(unknown).toMatchObject({ id: 2, result: { protocolVersion: '2025-11-25' } });
  });

  it('lists the registered tools', async () => {
    const reply = await handle('{"jsonrpc":"2.0","id":3,"method":"tools/list"}');
    expect(reply).toMatchObject({ result: { tools: [{ name: 'echo' }] } });
  });

  it('answers notifications and blank lines with nothing', async () => {
    expect(await handle('{"jsonrpc":"2.0","method":"notifications/initialized"}')).toBeNull();
    expect(await handle('   ')).toBeNull();
  });

  it('rejects unknown methods, including prototype names', async () => {
    for (const method of ['nope', 'constructor', '__proto__']) {
      const reply = await handle(JSON.stringify({ jsonrpc: '2.0', id: 4, method }));
      expect(reply).toMatchObject({ error: { code: METHOD_NOT_FOUND } });
    }
  });
});

describe('tools/call', () => {
  it('runs a tool and returns its result', async () => {
    const reply = await createServer([echo])(call('echo', { text: 'hi' }));
    expect(reply).toMatchObject({ id: 1, result: { content: [{ type: 'text', text: 'hi' }] } });
  });

  it('passes tool-level errors through as results', async () => {
    const failing = tool('failing', () => toolError('no such record'));
    const reply = await createServer([failing])(call('failing', {}));
    expect(reply).toMatchObject({ result: { isError: true, content: [{ text: 'no such record' }] } });
  });

  it('rejects unknown tools and bad arguments with INVALID_PARAMS', async () => {
    const handle = createServer([echo]);
    expect(await handle(call('missing', {}))).toMatchObject({ error: { code: INVALID_PARAMS } });
    expect(await handle(call('echo', 'not an object'))).toMatchObject({ error: { code: INVALID_PARAMS } });
  });

  it('keeps a tool RpcError and hides other throws without logging arguments', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const rpc = tool('rpc', () => {
      throw new RpcError(INVALID_PARAMS, 'bad query');
    });
    const crash = tool('crash', () => {
      throw new Error('leaked-secret-value');
    });
    const handle = createServer([rpc, crash]);
    expect(await handle(call('rpc', {}))).toMatchObject({ error: { code: INVALID_PARAMS, message: 'bad query' } });
    expect(await handle(call('crash', { token: 'sk-arg-value' }))).toMatchObject({ error: { code: INTERNAL_ERROR } });
    const logged = stderr.mock.calls.map((args) => String(args[0])).join('');
    expect(logged).toContain('tool crash failed');
    expect(logged).not.toContain('leaked-secret-value');
    expect(logged).not.toContain('sk-arg-value');
  });

  it('turns a non-object or oversized result into INTERNAL_ERROR', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const bad = tool('bad', () => 'text' as unknown as Record<string, unknown>);
    const huge = tool('huge', () => ({ content: [{ type: 'text', text: 'x'.repeat(MAX_RESULT_BYTES) }] }));
    const handle = createServer([bad, huge]);
    expect(await handle(call('bad', {}))).toMatchObject({ error: { code: INTERNAL_ERROR } });
    expect(await handle(call('huge', {}))).toMatchObject({ error: { code: INTERNAL_ERROR } });
  });
});

describe('registry validation at startup', () => {
  it('rejects duplicate and invalid names', () => {
    expect(() => createServer([echo, echo])).toThrow(/duplicate tool name/);
    expect(() => createServer([tool('Bad-Name', echo.handler)])).toThrow(/invalid tool name/);
  });

  it(`rejects more than ${String(MAX_TOOLS)} tools`, () => {
    const many = Array.from({ length: MAX_TOOLS + 1 }, (_, i) => tool(`t${String(i)}`, echo.handler));
    expect(() => createServer(many)).toThrow(/at most 64 tools/);
  });
});
