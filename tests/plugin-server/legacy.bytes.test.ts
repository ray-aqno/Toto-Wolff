// Legacy (MCP 2025-11-25) replies pinned byte for byte. Every expected string
// below was captured from the server at fa40059, before the dual-era change
// (#66), and is a literal: nothing here recomputes it. Any change to legacy
// output, including key order or a stray undefined-valued field, fails a test.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createServer } from '../../plugin/server/mcp/server.mts';
import type { Tool } from '../../plugin/server/mcp/server.mts';

const ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), '../../plugin/server/index.mts');
const echo: Tool = {
  definition: { name: 'echo', description: 'echo tool', inputSchema: { type: 'object' } },
  handler: (args) => ({ content: [{ type: 'text', text: String(args.text) }] }),
};

const IN_PROCESS: readonly (readonly [string, string | null])[] = [
  ["{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-11-25\",\"capabilities\":{},\"clientInfo\":{\"name\":\"c\",\"version\":\"1\"}}}",
   "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2025-11-25\",\"capabilities\":{\"tools\":{}},\"serverInfo\":{\"name\":\"toto-wolff\",\"version\":\"2.0.0-dev.1\"}}}"],
  ["{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"ping\"}",
   "{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{}}"],
  ["{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/list\"}",
   "{\"jsonrpc\":\"2.0\",\"id\":3,\"result\":{\"tools\":[{\"name\":\"echo\",\"description\":\"echo tool\",\"inputSchema\":{\"type\":\"object\"}}]}}"],
  ["{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"echo\",\"arguments\":{\"text\":\"hi\"}}}",
   "{\"jsonrpc\":\"2.0\",\"id\":4,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"hi\"}]}}"],
  ["{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{\"name\":\"nope\",\"arguments\":{}}}",
   "{\"jsonrpc\":\"2.0\",\"id\":5,\"error\":{\"code\":-32602,\"message\":\"Unknown tool: nope\"}}"],
  ["{\"jsonrpc\":\"2.0\",\"id\":6,\"method\":\"no/such\"}",
   "{\"jsonrpc\":\"2.0\",\"id\":6,\"error\":{\"code\":-32601,\"message\":\"Method not found\"}}"],
  ["{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"initialize\",\"params\":{}}",
   "{\"jsonrpc\":\"2.0\",\"id\":7,\"error\":{\"code\":-32602,\"message\":\"initialize needs a protocolVersion string\"}}"],
  ["{\"jsonrpc\":\"2.0\",\"id\":null,\"method\":\"ping\"}",
   "{\"jsonrpc\":\"2.0\",\"id\":null,\"result\":{}}"],
  ["{\"jsonrpc\":\"2.0\",\"id\":8,\"method\":\"tools/list\",\"params\":{\"_meta\":{\"progressToken\":\"p1\"}}}",
   "{\"jsonrpc\":\"2.0\",\"id\":8,\"result\":{\"tools\":[{\"name\":\"echo\",\"description\":\"echo tool\",\"inputSchema\":{\"type\":\"object\"}}]}}"],
  ["{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"tools/list\",\"params\":{\"_meta\":{\"io.modelcontextprotocol/clientInfo\":{\"name\":\"c\",\"version\":\"1\"}}}}",
   "{\"jsonrpc\":\"2.0\",\"id\":9,\"result\":{\"tools\":[{\"name\":\"echo\",\"description\":\"echo tool\",\"inputSchema\":{\"type\":\"object\"}}]}}"],
  ["{\"jsonrpc\":\"2.0\",\"id\":10,\"method\":\"tools/list\",\"params\":{\"_meta\":{\"io.modelcontextprotocol/logLevel\":\"info\"}}}",
   "{\"jsonrpc\":\"2.0\",\"id\":10,\"result\":{\"tools\":[{\"name\":\"echo\",\"description\":\"echo tool\",\"inputSchema\":{\"type\":\"object\"}}]}}"],
  ["{\"jsonrpc\":\"2.0\",\"id\":11,\"method\":\"tools/list\",\"params\":{\"_meta\":{\"traceparent\":\"00-0af7651916cd43dd8448eb211c80319c-00f067aa0ba902b7-01\"}}}",
   "{\"jsonrpc\":\"2.0\",\"id\":11,\"result\":{\"tools\":[{\"name\":\"echo\",\"description\":\"echo tool\",\"inputSchema\":{\"type\":\"object\"}}]}}"],
  ["{\"jsonrpc\":\"2.0\",\"id\":12,\"method\":\"tools/call\",\"params\":{\"name\":\"echo\",\"arguments\":{\"text\":\"x\"},\"_meta\":{\"progressToken\":7}}}",
   "{\"jsonrpc\":\"2.0\",\"id\":12,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"x\"}]}}"],
  ["{\"jsonrpc\":\"2.0\",\"id\":13,\"method\":\"tools/call\",\"params\":{\"name\":\"echo\",\"arguments\":{\"text\":\"y\"},\"_meta\":{\"io.modelcontextprotocol/logLevel\":\"debug\"}}}",
   "{\"jsonrpc\":\"2.0\",\"id\":13,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"y\"}]}}"],
  ["{\"jsonrpc\":\"2.0\",\"id\":14,\"method\":\"tools/list\",\"params\":{\"cursor\":\"abc\"}}",
   "{\"jsonrpc\":\"2.0\",\"id\":14,\"result\":{\"tools\":[{\"name\":\"echo\",\"description\":\"echo tool\",\"inputSchema\":{\"type\":\"object\"}}]}}"],
  ["[{\"jsonrpc\":\"2.0\",\"id\":15,\"method\":\"ping\"}]",
   "{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32600,\"message\":\"Batch requests are not supported\"}}"],
  ["{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}",
   null],
  ["{\"jsonrpc\":\"2.0\",\"method\":\"notifications/cancelled\",\"params\":{\"requestId\":2}}",
   null],
];

const SPAWN_INPUT: readonly string[] = [
  "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-11-25\",\"capabilities\":{},\"clientInfo\":{\"name\":\"c\",\"version\":\"1\"}}}",
  "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"ping\"}",
  "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/list\"}",
  "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"echo\",\"arguments\":{\"text\":\"hi\"}}}",
  "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{\"name\":\"nope\",\"arguments\":{}}}",
  "{\"jsonrpc\":\"2.0\",\"id\":6,\"method\":\"no/such\"}",
  "{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"initialize\",\"params\":{}}",
  "{\"jsonrpc\":\"2.0\",\"id\":null,\"method\":\"ping\"}",
  "{\"jsonrpc\":\"2.0\",\"id\":8,\"method\":\"tools/list\",\"params\":{\"_meta\":{\"progressToken\":\"p1\"}}}",
  "{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"tools/list\",\"params\":{\"_meta\":{\"io.modelcontextprotocol/clientInfo\":{\"name\":\"c\",\"version\":\"1\"}}}}",
  "{\"jsonrpc\":\"2.0\",\"id\":10,\"method\":\"tools/list\",\"params\":{\"_meta\":{\"io.modelcontextprotocol/logLevel\":\"info\"}}}",
  "{\"jsonrpc\":\"2.0\",\"id\":11,\"method\":\"tools/list\",\"params\":{\"_meta\":{\"traceparent\":\"00-0af7651916cd43dd8448eb211c80319c-00f067aa0ba902b7-01\"}}}",
  "{\"jsonrpc\":\"2.0\",\"id\":12,\"method\":\"tools/call\",\"params\":{\"name\":\"echo\",\"arguments\":{\"text\":\"x\"},\"_meta\":{\"progressToken\":7}}}",
  "{\"jsonrpc\":\"2.0\",\"id\":13,\"method\":\"tools/call\",\"params\":{\"name\":\"echo\",\"arguments\":{\"text\":\"y\"},\"_meta\":{\"io.modelcontextprotocol/logLevel\":\"debug\"}}}",
  "{\"jsonrpc\":\"2.0\",\"id\":14,\"method\":\"tools/list\",\"params\":{\"cursor\":\"abc\"}}",
  "[{\"jsonrpc\":\"2.0\",\"id\":15,\"method\":\"ping\"}]",
  "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}",
  "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/cancelled\",\"params\":{\"requestId\":2}}",
];

const SPAWN_OUTPUT: readonly string[] = [
  "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2025-11-25\",\"capabilities\":{\"tools\":{}},\"serverInfo\":{\"name\":\"toto-wolff\",\"version\":\"2.0.0-dev.1\"}}}",
  "{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{}}",
  "{\"jsonrpc\":\"2.0\",\"id\":3,\"result\":{\"tools\":[]}}",
  "{\"jsonrpc\":\"2.0\",\"id\":4,\"error\":{\"code\":-32602,\"message\":\"Unknown tool: echo\"}}",
  "{\"jsonrpc\":\"2.0\",\"id\":5,\"error\":{\"code\":-32602,\"message\":\"Unknown tool: nope\"}}",
  "{\"jsonrpc\":\"2.0\",\"id\":6,\"error\":{\"code\":-32601,\"message\":\"Method not found\"}}",
  "{\"jsonrpc\":\"2.0\",\"id\":7,\"error\":{\"code\":-32602,\"message\":\"initialize needs a protocolVersion string\"}}",
  "{\"jsonrpc\":\"2.0\",\"id\":null,\"result\":{}}",
  "{\"jsonrpc\":\"2.0\",\"id\":8,\"result\":{\"tools\":[]}}",
  "{\"jsonrpc\":\"2.0\",\"id\":9,\"result\":{\"tools\":[]}}",
  "{\"jsonrpc\":\"2.0\",\"id\":10,\"result\":{\"tools\":[]}}",
  "{\"jsonrpc\":\"2.0\",\"id\":11,\"result\":{\"tools\":[]}}",
  "{\"jsonrpc\":\"2.0\",\"id\":12,\"error\":{\"code\":-32602,\"message\":\"Unknown tool: echo\"}}",
  "{\"jsonrpc\":\"2.0\",\"id\":13,\"error\":{\"code\":-32602,\"message\":\"Unknown tool: echo\"}}",
  "{\"jsonrpc\":\"2.0\",\"id\":14,\"result\":{\"tools\":[]}}",
  "{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32600,\"message\":\"Batch requests are not supported\"}}",
];

describe('legacy replies are byte-identical to fa40059', () => {
  it.each(IN_PROCESS.map(([input, output], i) => [i, input, output] as const))('case %i', async (_i, input, output) => {
    const reply = await createServer([echo])(input);
    expect(reply === null ? null : JSON.stringify(reply)).toBe(output);
  });

  it('the real entry (empty tool registry) answers the same stream byte for byte', () => {
    const run = spawnSync(process.execPath, [ENTRY], { input: `${SPAWN_INPUT.join('\n')}\n`, encoding: 'utf8', timeout: 20_000 });
    expect(run.status).toBe(0);
    expect(run.stderr).toBe('');
    expect(run.stdout).toBe(`${SPAWN_OUTPUT.join('\n')}\n`);
  });
});
