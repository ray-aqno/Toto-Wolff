import { createServer } from 'node:http';
import { isAbsolute } from 'node:path';
import assert from 'node:assert';
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
  score_confidence:   (body) => handleScoreConfidence(body),
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

// LOOP BOUND: 1 attempt — fail loud on EADDRINUSE, no retry (Condition 3)
// CSO: bind loopback only — prevents LAN access to unauthenticated LLM proxy
server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`toto-mcp listening on port ${PORT}\n`);
});
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    process.stderr.write(`ERROR: Port ${PORT} in use. Set TOTO_MCP_PORT to a free port.\n`);
    process.exit(1);
  }
  process.stderr.write(`ERROR: server error: ${err.message}\n`);
  process.exit(1);
});
