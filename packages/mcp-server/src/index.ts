import { createServer } from 'node:http';
import { isAbsolute } from 'node:path';
import { join } from 'node:path';
import assert from 'node:assert';
import { readdir, readFile, stat } from 'node:fs/promises';
import { VaultService, CouncilService, P10Service } from '@toto-wolff/core';
import { MCPValidationError, handleVaultWrite } from './handlers/vault_write.js';
import { handleVaultSearch } from './handlers/vault_search.js';
import { handleCouncilRun } from './handlers/council_run.js';
import { handleP10Plan } from './handlers/p10_plan.js';
import { renderDashboardHtml } from './handlers/dashboard_html.js';
import type { DashboardResult, DashboardItem } from './handlers/dashboard_html.js';

const PORT = parseInt(process.env['TOTO_MCP_PORT'] ?? '3099', 10);
const VAULT_PATH = process.env['TOTO_VAULT_PATH'] ?? `${process.env['HOME'] ?? ''}/Documents/Obsidian Vault`;

assert(isAbsolute(VAULT_PATH), 'VAULT_PATH must be absolute');
// CSO: API key presence checked at service construction, not here — avoids logging it

const vault = new VaultService(VAULT_PATH);
const council = new CouncilService(vault);
const p10 = new P10Service(vault);

/** Extract YYYY-MM-DD from a filename. Returns 'unknown' if no date found. */
function extractDate(filename: string): string {
  const match = filename.match(/(\d{4}-\d{2}-\d{2})/);
  return match ? (match[1] ?? 'unknown') : 'unknown';
}

/** Extract status from file content by scanning for "Status:" lines. */
function extractStatus(content: string): string {
  const match = content.match(/[Ss]tatus:\s*(.+)/);
  if (!match) return 'unknown';
  const raw = (match[1] ?? '').trim().toLowerCase();
  if (raw.includes('approved')) return 'approved';
  if (raw.includes('blocked')) return 'blocked';
  if (raw.includes('revision')) return 'revision-required';
  return raw.slice(0, 40);
}

/**
 * Reads the last `limit` files from a directory, sorted by name descending.
 * Returns an empty array if the directory does not exist.
 */
async function readRecentItems(dir: string, limit: number): Promise<{ all: string[]; items: DashboardItem[] }> {
  let filenames: string[];
  try {
    await stat(dir);
    filenames = (await readdir(dir)).filter((f) => !f.startsWith('.')).sort().reverse();
  } catch {
    return { all: [], items: [] };
  }

  const recent = filenames.slice(0, limit);
  const items: DashboardItem[] = [];

  for (const filename of recent) {
    const filepath = join(dir, filename);
    let content = '';
    try {
      content = await readFile(filepath, 'utf8');
    } catch {
      // unreadable file — skip gracefully
    }
    items.push({
      date: extractDate(filename),
      excerpt: content.slice(0, 80).replace(/\n/g, ' ').trim(),
      status: extractStatus(content),
    });
  }

  return { all: filenames, items };
}

/** dashboard_status: returns a snapshot of recent council sessions and P10 plans from the vault. */
async function handleDashboardStatus(): Promise<DashboardResult> {
  const councilDir = join(VAULT_PATH, 'Council', 'Congressional-Records');
  const p10Dir = join(VAULT_PATH, 'P10-Plans');

  const [councilData, p10Data] = await Promise.all([
    readRecentItems(councilDir, 5),
    readRecentItems(p10Dir, 5),
  ]);

  const blockedItems: DashboardResult['blockedItems'] = [
    ...councilData.items
      .filter((i) => i.status === 'blocked')
      .map((i) => ({ type: 'council' as const, date: i.date, excerpt: i.excerpt })),
    ...p10Data.items
      .filter((i) => i.status === 'blocked')
      .map((i) => ({ type: 'p10' as const, date: i.date, excerpt: i.excerpt })),
  ];

  return {
    councilSessions: { count: councilData.all.length, recent: councilData.items },
    p10Plans: { count: p10Data.all.length, recent: p10Data.items },
    blockedItems,
    generatedAt: new Date().toISOString(),
  };
}

const TOOLS: Record<string, (body: unknown) => Promise<unknown>> = {
  vault_write:       (body) => handleVaultWrite(body, vault),
  vault_search:      (body) => handleVaultSearch(body, vault),
  council_run:       (body) => handleCouncilRun(body, council),
  p10_plan:          (body) => handleP10Plan(body, p10),
  dashboard_status:  ()     => handleDashboardStatus(),
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
    if (!res.headersSent) void handleRequest(req.url ?? '', req.method ?? 'GET', raw, res);
  });
});

/**
 * Routes an incoming HTTP request to the appropriate tool handler or the HTML dashboard.
 * Intercepts GET /dashboard before the TOOLS lookup and returns server-rendered HTML.
 * Returns 405 for non-GET requests to /dashboard, 404 for unknown tool paths.
 */
async function handleRequest(url: string, method: string, raw: string, res: import('node:http').ServerResponse): Promise<void> {
  if (url === '/dashboard') {
    if (method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'method not allowed' }));
      return;
    }
    const data = await handleDashboardStatus();
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
