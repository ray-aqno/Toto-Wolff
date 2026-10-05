// The optional dashboard HTTP server. Off unless TOTO_MCP_PORT is set: every
// Claude session runs its own plugin server, so a fixed default port would be
// raced by each one. Binds 127.0.0.1 only, serves GET routes only (v1's POST
// tool routes are gone) and answers only requests whose Host header names
// this server, which blocks DNS rebinding. Any listen error is one stderr
// warning; the MCP tools keep working without the dashboard.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import process from 'node:process';
import { renderDashboardHtml } from '../handlers/dashboard_html.mts';
import { handleDashboardStatus } from '../handlers/dashboard_status.mts';
import { handleRecordRequest } from '../handlers/record_handler.mts';
import { handleSseRequest } from '../handlers/sse_handler.mts';
import { closeAllClients } from '../handlers/sse_registry.mts';
import { handleVaultReversed } from '../handlers/vault_reversed.mts';
import { handleVaultSignal } from '../handlers/vault_signal.mts';

const HOST = '127.0.0.1';
const PORT_PATTERN = /^\d{1,5}$/;

export interface Dashboard {
  readonly port: number;
  close(): Promise<void>;
}

/**
 * The dashboard port from TOTO_MCP_PORT, or null when it is unset. An
 * invalid value is one stderr warning and no dashboard.
 */
export function dashboardPort(env: NodeJS.ProcessEnv): number | null {
  const raw = env['TOTO_MCP_PORT'];
  if (raw === undefined || raw === '') return null;
  const port = PORT_PATTERN.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write('toto-wolff: TOTO_MCP_PORT must be a port number from 1 to 65535; dashboard disabled\n');
    return null;
  }
  assert.ok(port >= 1 && port <= 65535, 'the port is in range');
  return port;
}

function sendText(res: ServerResponse, status: number, text: string): void {
  assert.ok(status >= 400 && status < 600, 'sendText sends errors only');
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(text);
}

type Route = (req: IncomingMessage, res: ServerResponse, vaultPath: string) => Promise<void>;

async function serveDashboard(_req: IncomingMessage, res: ServerResponse, vaultPath: string): Promise<void> {
  const data = await handleDashboardStatus(vaultPath);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderDashboardHtml(data));
}

// The v1 GET routes, matched as v1 matched them.
function routeFor(url: string): Route | null {
  if (url === '/dashboard') return serveDashboard;
  if (url === '/dashboard/events') return (req, res, vaultPath) => Promise.resolve(handleSseRequest(req, res, vaultPath));
  if (url.startsWith('/dashboard/record')) return handleRecordRequest;
  if (url.startsWith('/vault/reversed')) return handleVaultReversed;
  if (url === '/vault/signal') return handleVaultSignal;
  return null;
}

async function handle(req: IncomingMessage, res: ServerResponse, allowedHosts: readonly string[], vaultPath: string): Promise<void> {
  assert.ok(allowedHosts.length > 0, 'some Host values are allowed');
  if (!allowedHosts.includes(req.headers.host ?? '')) {
    sendText(res, 403, 'Forbidden');
    return;
  }
  const route = routeFor(req.url ?? '');
  if (route === null) {
    sendText(res, 404, 'Not found');
    return;
  }
  if (req.method !== 'GET') {
    sendText(res, 405, 'Method not allowed');
    return;
  }
  try {
    await route(req, res, vaultPath);
  } catch (err) {
    const kind = err instanceof Error ? err.name : typeof err;
    process.stderr.write(`toto-wolff: dashboard request failed (${kind})\n`);
    sendText(res, 500, 'Internal error');
  }
}

function listen(server: Server, port: number): Promise<number | null> {
  return new Promise((done) => {
    const onError = (err: NodeJS.ErrnoException): void => {
      process.stderr.write(`toto-wolff: dashboard disabled, cannot listen on ${HOST}:${String(port)} (${err.code ?? err.name}); MCP tools still work\n`);
      done(null);
    };
    server.once('error', onError);
    server.listen(port, HOST, () => {
      server.off('error', onError);
      const address = server.address();
      done(address !== null && typeof address === 'object' ? address.port : null);
    });
  });
}

/**
 * Starts the dashboard on 127.0.0.1:`port` (0 picks a free port, for tests).
 * Resolves null, after one stderr warning, when the port cannot be used.
 */
export async function startDashboard(options: { port: number; vaultPath: string }): Promise<Dashboard | null> {
  assert.ok(Number.isInteger(options.port) && options.port >= 0 && options.port <= 65535, 'the port is in range');
  assert.ok(options.vaultPath.length > 0, 'the dashboard has a vault path');
  let allowedHosts: readonly string[] = [];
  const server = createServer((req, res) => void handle(req, res, allowedHosts, options.vaultPath));
  const port = await listen(server, options.port);
  if (port === null) return null;
  // The bound port, not the requested one, so port 0 works too.
  allowedHosts = [`${HOST}:${String(port)}`, `localhost:${String(port)}`];
  server.on('error', (err: NodeJS.ErrnoException) => {
    process.stderr.write(`toto-wolff: dashboard server error (${err.code ?? err.name})\n`);
  });
  process.stderr.write(`toto-wolff: dashboard at http://${HOST}:${String(port)}/dashboard\n`);
  return {
    port,
    close: () =>
      new Promise((done) => {
        closeAllClients();
        server.close(() => done());
        server.closeAllConnections();
      }),
  };
}
