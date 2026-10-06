// Legacy (MCP 2025-11-25) replies pinned byte for byte. Every expected string
// below was captured from the server at fa40059, before the dual-era change
// (#66), and is a literal: nothing here recomputes it. Any change to legacy
// output, including key order or a stray undefined-valued field, fails a test.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { createLineHandler } from '../../plugin/server/mcp/server.mts';
import type { Tool } from '../../plugin/server/mcp/server.mts';
import { isolatedEnv, removeIsolatedEnvs, serverEnv } from './spawn-env.ts';

const ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), '../../plugin/server/index.mts');
const echo: Tool = {
  definition: { name: 'echo', description: 'echo tool', inputSchema: { type: 'object' } },
  handler: (args) => ({ content: [{ type: 'text', text: String(args.text) }] }),
};

// The tools' definitions as the real entry lists them (#60, #61), captured from
// the server once and kept as a literal like everything else here.
const SIX_TOOLS = "[{\"name\":\"vault_write\",\"description\":\"Write a record to the toto vault (path relative to the vault root)\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"path\":{\"type\":\"string\"},\"content\":{\"type\":\"string\"}},\"required\":[\"path\",\"content\"]}},{\"name\":\"vault_search\",\"description\":\"Search vault records for literal, case-sensitive text\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}},\"required\":[\"query\"]}},{\"name\":\"drs_check\",\"description\":\"Check a tool call against DRS boundary rules\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"tool\":{\"type\":\"string\",\"enum\":[\"Write\",\"Edit\",\"NotebookEdit\",\"Bash\"]},\"target_path\":{\"type\":\"string\"},\"command\":{\"type\":\"string\"},\"message_before\":{\"type\":\"string\"}},\"required\":[\"tool\"]}},{\"name\":\"subagent_list\",\"description\":\"List available subagents\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"scope\":{\"type\":\"string\",\"enum\":[\"user\",\"project\",\"both\"]}}}},{\"name\":\"dashboard_status\",\"description\":\"Get current vault stats for the dashboard\",\"inputSchema\":{\"type\":\"object\",\"properties\":{}}},{\"name\":\"score_confidence\",\"description\":\"Score confidence of a council ruling\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"ruling\":{\"type\":\"string\"}},\"required\":[\"ruling\"]}},{\"name\":\"graph_list\",\"description\":\"List the task graphs this project can run\",\"inputSchema\":{\"type\":\"object\",\"properties\":{}}},{\"name\":\"graph_template\",\"description\":\"Get the RFC or ADR document template (Markdown)\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"kind\":{\"type\":\"string\",\"enum\":[\"rfc\",\"adr\"]}},\"required\":[\"kind\"]}},{\"name\":\"graph_start\",\"description\":\"Start a run of a graph; returns the run id and the first step\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"graph\":{\"type\":\"string\"},\"input\":{\"type\":\"object\",\"properties\":{\"idea\":{\"type\":\"string\"}},\"required\":[\"idea\"]},\"stopAt\":{\"type\":\"string\"}},\"required\":[\"graph\",\"input\"]}},{\"name\":\"graph_next\",\"description\":\"Get a run's current step (read-only)\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"runId\":{\"type\":\"string\"}},\"required\":[\"runId\"]}},{\"name\":\"graph_report\",\"description\":\"Report the outcome of the current skill, choice or loop step\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"runId\":{\"type\":\"string\"},\"nodeId\":{\"type\":\"string\"},\"outcome\":{\"type\":\"string\",\"enum\":[\"pass\",\"fail\"]},\"evidence\":{\"type\":\"string\"},\"artifacts\":{\"type\":\"array\",\"items\":{\"type\":\"string\"}},\"choice\":{\"type\":\"string\"},\"iteration\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":10}},\"required\":[\"runId\",\"nodeId\",\"outcome\",\"evidence\"]}},{\"name\":\"graph_approve\",\"description\":\"Record a person's decision at a human_gate step (ask the user first)\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"runId\":{\"type\":\"string\"},\"nodeId\":{\"type\":\"string\"},\"decision\":{\"type\":\"string\",\"enum\":[\"approve\",\"reject\"]},\"note\":{\"type\":\"string\"}},\"required\":[\"runId\",\"nodeId\",\"decision\"]}},{\"name\":\"graph_status\",\"description\":\"Get a run's status and the state of every node\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"runId\":{\"type\":\"string\"}},\"required\":[\"runId\"]}},{\"name\":\"graph_resume\",\"description\":\"Continue a run from its last checkpoint; optionally set a new stop target\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"runId\":{\"type\":\"string\"},\"stopAt\":{\"type\":\"string\"}},\"required\":[\"runId\"]}}]";

const IN_PROCESS: readonly (readonly [string, string | null])[] = [
  ["{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-11-25\",\"capabilities\":{},\"clientInfo\":{\"name\":\"c\",\"version\":\"1\"}}}",
   "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2025-11-25\",\"capabilities\":{\"tools\":{}},\"serverInfo\":{\"name\":\"toto-wolff\",\"version\":\"2.0.0\"}}}"],
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
  "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2025-11-25\",\"capabilities\":{\"tools\":{}},\"serverInfo\":{\"name\":\"toto-wolff\",\"version\":\"2.0.0\"}}}",
  "{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{}}",
  "{\"jsonrpc\":\"2.0\",\"id\":3,\"result\":{\"tools\":" + SIX_TOOLS + "}}",
  "{\"jsonrpc\":\"2.0\",\"id\":4,\"error\":{\"code\":-32602,\"message\":\"Unknown tool: echo\"}}",
  "{\"jsonrpc\":\"2.0\",\"id\":5,\"error\":{\"code\":-32602,\"message\":\"Unknown tool: nope\"}}",
  "{\"jsonrpc\":\"2.0\",\"id\":6,\"error\":{\"code\":-32601,\"message\":\"Method not found\"}}",
  "{\"jsonrpc\":\"2.0\",\"id\":7,\"error\":{\"code\":-32602,\"message\":\"initialize needs a protocolVersion string\"}}",
  "{\"jsonrpc\":\"2.0\",\"id\":null,\"result\":{}}",
  "{\"jsonrpc\":\"2.0\",\"id\":8,\"result\":{\"tools\":" + SIX_TOOLS + "}}",
  "{\"jsonrpc\":\"2.0\",\"id\":9,\"result\":{\"tools\":" + SIX_TOOLS + "}}",
  "{\"jsonrpc\":\"2.0\",\"id\":10,\"result\":{\"tools\":" + SIX_TOOLS + "}}",
  "{\"jsonrpc\":\"2.0\",\"id\":11,\"result\":{\"tools\":" + SIX_TOOLS + "}}",
  "{\"jsonrpc\":\"2.0\",\"id\":12,\"error\":{\"code\":-32602,\"message\":\"Unknown tool: echo\"}}",
  "{\"jsonrpc\":\"2.0\",\"id\":13,\"error\":{\"code\":-32602,\"message\":\"Unknown tool: echo\"}}",
  "{\"jsonrpc\":\"2.0\",\"id\":14,\"result\":{\"tools\":" + SIX_TOOLS + "}}",
  "{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32600,\"message\":\"Batch requests are not supported\"}}",
];

describe('legacy replies are byte-identical to fa40059', () => {
  afterAll(removeIsolatedEnvs);

  it.each(IN_PROCESS.map(([input, output], i) => [i, input, output] as const))('case %i', async (_i, input, output) => {
    const reply = await createLineHandler([echo])(input);
    expect(reply === null ? null : JSON.stringify(reply)).toBe(output);
  });

  it('the real entry (the #60 and #61 tools) answers the same stream byte for byte', () => {
    const run = spawnSync(process.execPath, [ENTRY], { input: `${SPAWN_INPUT.join('\n')}\n`, encoding: 'utf8', timeout: 20_000, env: isolatedEnv(serverEnv()) });
    expect(run.status).toBe(0);
    expect(run.stderr).toBe('');
    expect(run.stdout).toBe(`${SPAWN_OUTPUT.join('\n')}\n`);
  });
});
