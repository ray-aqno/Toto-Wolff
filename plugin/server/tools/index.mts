// The tools this server registers, built around one runtime. Each tool
// returns its handler's result as JSON text, as v1 did; the modern era adds
// resultType and serverInfo around it (mcp/modern.mts). A handler's input
// error becomes -32602; anything else is an internal error (mcp/server.mts).
import assert from 'node:assert/strict';
import process from 'node:process';
import { INVALID_PARAMS, RpcError } from '../mcp/protocol.mts';
import type { Message } from '../mcp/protocol.mts';
import type { Tool, ToolDefinition } from '../mcp/server.mts';
import { drainQuietly } from '../runtime.mts';
import type { Runtime } from '../runtime.mts';
import { writeDashboardPage } from '../handlers/dashboard_page.mts';
import { handleDashboardStatus } from '../handlers/dashboard_status.mts';
import { handleDrsCheck } from '../handlers/drs_check.mts';
import { handleScoreConfidence } from '../handlers/score_confidence_tool.mts';
import { handleSubagentList } from '../handlers/subagent_list.mts';
import { handleVaultSearch } from '../handlers/vault_search.mts';
import { MCPValidationError, handleVaultWrite } from '../handlers/vault_write.mts';
import { GRAPH_DEFINITIONS, createGraphTools } from '../graph/tools.mts';

const STRING = { type: 'string' } as const;

export const DEFINITIONS: Readonly<Record<string, ToolDefinition>> = {
  vault_write: { name: 'vault_write', description: 'Write a record to the toto vault (path relative to the vault root)', inputSchema: { type: 'object', properties: { path: STRING, content: STRING }, required: ['path', 'content'] } },
  vault_search: { name: 'vault_search', description: 'Search vault records for literal, case-sensitive text', inputSchema: { type: 'object', properties: { query: STRING }, required: ['query'] } },
  drs_check: { name: 'drs_check', description: 'Check a tool call against DRS boundary rules', inputSchema: { type: 'object', properties: { tool: { type: 'string', enum: ['Write', 'Edit', 'NotebookEdit', 'Bash'] }, target_path: STRING, command: STRING, message_before: STRING }, required: ['tool'] } },
  subagent_list: { name: 'subagent_list', description: 'List available subagents', inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['user', 'project', 'both'] } } } },
  dashboard_status: { name: 'dashboard_status', description: 'Get current vault stats for the dashboard', inputSchema: { type: 'object', properties: {} } },
  score_confidence: { name: 'score_confidence', description: 'Score confidence of a council ruling', inputSchema: { type: 'object', properties: { ruling: STRING }, required: ['ruling'] } },
  ...Object.fromEntries(GRAPH_DEFINITIONS.map((d) => [d.name, d])),
};

function definition(name: string): ToolDefinition {
  const found = DEFINITIONS[name];
  assert.ok(found !== undefined && found.name === name, `tool ${name} has a definition`);
  return found;
}

// Wraps a handler: JSON text result, MCPValidationError -> -32602.
function adapt(name: string, run: (args: Record<string, unknown>) => Promise<unknown>): Tool {
  return {
    definition: definition(name),
    handler: async (args: Record<string, unknown>): Promise<Message> => {
      let result: unknown;
      try {
        result = await run(args);
      } catch (err) {
        if (err instanceof MCPValidationError) throw new RpcError(INVALID_PARAMS, err.message);
        throw err;
      }
      assert.ok(result !== undefined, `tool ${name} returned a result`);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  };
}

function requireRuling(args: Record<string, unknown>): void {
  const ruling = args['ruling'];
  if (typeof ruling !== 'string' || ruling.length === 0) throw new MCPValidationError('ruling must be non-empty string');
}

// Once dashboard_status has written the page, it is rewritten every
// PAGE_REFRESH_MS, so records any tool writes (the skills write with Claude's
// own file tools) appear without another call. A failed rewrite is one stderr
// line; an overlapping one is skipped.
const PAGE_REFRESH_MS = 15_000;

function pageRefresher(vaultPath: string): () => Promise<void> {
  let busy = false;
  return async () => {
    if (busy) return;
    busy = true;
    try {
      await writeDashboardPage(vaultPath);
    } catch (err) {
      process.stderr.write('toto-wolff: dashboard page not refreshed: ' + (err instanceof Error ? err.message : String(err)) + '\n');
    } finally {
      busy = false;
    }
  };
}

export function createTools(runtime: Runtime): Tool[] {
  assert.ok(runtime.vaultPath.length > 0, 'the runtime has a vault path');
  const refreshPage = pageRefresher(runtime.vaultPath);
  let timer: ReturnType<typeof setInterval> | null = null;
  const tools = [
    adapt('vault_write', async (args) => {
      const vault = await runtime.vault();
      const written = await handleVaultWrite(args, vault);
      await drainQuietly(vault);
      // Keeps an open dashboard page current; a failed refresh never fails the write.
      if (runtime.pageWritten()) await refreshPage();
      return written;
    }),
    adapt('vault_search', async (args) => handleVaultSearch(args, await runtime.vault())),
    adapt('drs_check', (args) => handleDrsCheck(args, runtime.drs())),
    adapt('subagent_list', (args) => handleSubagentList(args, runtime.subagents)),
    adapt('dashboard_status', async () => {
      const stats = await handleDashboardStatus(runtime.vaultPath);
      // The stats are the answer; the page is a convenience, so a failed write
      // is one stderr line and `page: null`.
      const page = await writeDashboardPage(runtime.vaultPath).catch((err: unknown) => {
        process.stderr.write('toto-wolff: dashboard page not written: ' + (err instanceof Error ? err.message : String(err)) + '\n');
        return null;
      });
      if (page !== null) {
        runtime.markPageWritten();
        timer ??= setInterval(() => void refreshPage(), PAGE_REFRESH_MS);
        timer.unref();
      }
      return { ...stats, page };
    }),
    adapt('score_confidence', (args) => {
      requireRuling(args);
      return handleScoreConfidence(args, runtime.vaultPath);
    }),
    ...createGraphTools(() => runtime.projectDir()),
  ];
  assert.equal(tools.length, Object.keys(DEFINITIONS).length, 'every definition has a tool');
  return tools;
}
