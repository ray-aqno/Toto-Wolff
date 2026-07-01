import { createServer } from 'node:http';
import { isAbsolute } from 'node:path';
import assert from 'node:assert';
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { VaultService, CouncilService, P10Service } from '@toto-wolff/core';
import { MCPValidationError, handleVaultWrite } from './handlers/vault_write.js';
import { handleVaultSearch } from './handlers/vault_search.js';
import { handleCouncilRun } from './handlers/council_run.js';
import { handleP10Plan } from './handlers/p10_plan.js';
import { renderDashboardHtml } from './handlers/dashboard_html.js';
import { handleDashboardStatus } from './handlers/dashboard_status.js';
import { handleSseRequest } from './handlers/sse_handler.js';
import { handleRecordRequest } from './handlers/record_handler.js';
import { handleVaultSignal } from './handlers/vault_signal.js';
import { handleVaultReversed } from './handlers/vault_reversed.js';
import { handleScoreConfidence } from './handlers/score_confidence_tool.js';

const PORT = parseInt(process.env['TOTO_MCP_PORT'] ?? '3099', 10);
const VAULT_PATH = process.env['TOTO_VAULT_PATH'] ?? `${process.env['HOME'] ?? ''}/.toto/vault`;

// Prevent unhandled rejections from silently crashing the MCP stdio transport
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`ERROR: unhandledRejection — ${String(reason)}\n`);
});

assert(isAbsolute(VAULT_PATH), 'VAULT_PATH must be absolute');
// CSO: API key presence checked at service construction, not here — avoids logging it

const vault = new VaultService(VAULT_PATH);
const council = new CouncilService(vault);
const p10 = new P10Service(vault);

const TOOLS: Record<string, (body: unknown) => Promise<unknown> | unknown> = {
  vault_write:        (body) => handleVaultWrite(body, vault),
  vault_search:       (body) => handleVaultSearch(body, vault),
  council_run:        (body) => handleCouncilRun(body, council),
  p10_plan:           (body) => handleP10Plan(body, p10),
  dashboard_status:   ()     => handleDashboardStatus(VAULT_PATH),
  score_confidence:   (body) => handleScoreConfidence(body, VAULT_PATH),
};

const MAX_BODY_BYTES = 65_536;

const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk: Buffer) => {
    raw += chunk.toString();
    if (raw.length > MAX_BODY_BYTES) {
      res.writeHead(413, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: 'request body too large' }));
      req.destroy();
    }
  });
  req.on('end', () => {
    if (!res.headersSent) void handleRequest(req, req.url ?? '', req.method ?? 'GET', raw, res);
  });
});

/**
 * Routes an incoming HTTP request to the appropriate tool handler or the HTML dashboard.
 * Intercepts GET /dashboard before the TOOLS lookup and returns server-rendered HTML.
 * Returns 405 for non-GET requests to /dashboard, 404 for unknown tool paths.
 */
async function handleRequest(req: import('node:http').IncomingMessage, url: string, method: string, raw: string, res: import('node:http').ServerResponse): Promise<void> {
  if (url === '/dashboard/events') {
    if (method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'method not allowed' }));
      return;
    }
    handleSseRequest(req, res, VAULT_PATH);
    return;
  }
  if (url.startsWith('/dashboard/record')) {
    await handleRecordRequest(req, res, VAULT_PATH);
    return;
  }
  if (url.startsWith('/vault/reversed')) {
    if (method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'method not allowed' }));
      return;
    }
    await handleVaultReversed(req, res, VAULT_PATH);
    return;
  }
  if (url === '/vault/signal') {
    if (method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'method not allowed' }));
      return;
    }
    await handleVaultSignal(req, res, VAULT_PATH);
    return;
  }
  if (url === '/dashboard') {
    if (method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'method not allowed' }));
      return;
    }
    const data = await handleDashboardStatus(VAULT_PATH);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderDashboardHtml(data));
    return;
  }
  const tool = url.replace(/^\//, '');
  const handler = TOOLS[tool];
  if (handler === undefined) {
    res.writeHead(404).end(JSON.stringify({ error: 'unknown tool' }));
    return;
  }
  try {
    const body: unknown = raw.trim() === '' ? {} : JSON.parse(raw);
    const result = await handler(body);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
  } catch (err) {
    const isBadInput = err instanceof MCPValidationError || err instanceof SyntaxError;
    const status = isBadInput ? 400 : 500;
    // CSO: never reflect raw error internals — only message, no stack
    res.writeHead(status, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ error: (err as Error).message }));
  }
}

// CSO: bind loopback only — prevents LAN access to unauthenticated LLM proxy
// EADDRINUSE is non-fatal: MCP stdio transport continues without the dashboard HTTP server.
server.listen(PORT, '127.0.0.1', () => {
  process.stderr.write(`toto-mcp listening on port ${PORT}\n`);
});
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    process.stderr.write(`WARN: Port ${PORT} in use — dashboard HTTP server disabled. MCP tools still available. Set TOTO_MCP_PORT to enable dashboard.\n`);
    return; // non-fatal: MCP stdio transport continues
  }
  process.stderr.write(`ERROR: server error: ${err.message}\n`);
  process.exit(1);
});

// MCP stdio transport — tool calls from Claude Code come through here
const mcpServer = new McpServer(
  { name: 'toto-wolff', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'vault_write',       description: 'Write a record to the toto vault',                inputSchema: { type: 'object' as const, properties: { content: { type: 'string' }, filename: { type: 'string' } }, required: ['content', 'filename'] } },
    { name: 'vault_search',      description: 'Search vault records by query string',             inputSchema: { type: 'object' as const, properties: { query: { type: 'string' } }, required: ['query'] } },
    { name: 'council_run',       description: 'Run a council deliberation session',               inputSchema: { type: 'object' as const, properties: { question: { type: 'string' } }, required: ['question'] } },
    { name: 'p10_plan',          description: 'Generate a P10 pre-execution plan',                inputSchema: { type: 'object' as const, properties: { task: { type: 'string' } }, required: ['task'] } },
    { name: 'dashboard_status',  description: 'Get current vault stats for the dashboard',       inputSchema: { type: 'object' as const, properties: {} } },
    { name: 'score_confidence',  description: 'Score confidence of a council ruling',             inputSchema: { type: 'object' as const, properties: { ruling: { type: 'string' } }, required: ['ruling'] } },
  ],
}));

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const handler = TOOLS[request.params.name];
  if (!handler) {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }
  const result = await handler(request.params.arguments ?? {});
  return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
});

const transport = new StdioServerTransport();
mcpServer.connect(transport).catch((err: Error) => {
  process.stderr.write(`ERROR: MCP transport failed: ${err.message}\n`);
  process.exit(1);
});
