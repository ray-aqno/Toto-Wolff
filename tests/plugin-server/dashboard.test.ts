// The opt-in dashboard HTTP server (#60): off unless TOTO_MCP_PORT is set,
// 127.0.0.1 only, GET routes only, Host allowlist, listen errors downgraded.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request, createServer as createHttpServer } from 'node:http';
import type { Server, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { dashboardPort, startDashboard } from '../../plugin/server/dashboard/http.mts';
import { closeAllClients, isAtCapacity, registerClient } from '../../plugin/server/handlers/sse_registry.mts';
import type { Dashboard } from '../../plugin/server/dashboard/http.mts';
import { isolatedEnv, removeIsolatedEnvs } from './spawn-env.ts';

const ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), '../../plugin/server/index.mts');

let vault: string;
let dashboard: Dashboard;

function get(path: string, options: { host?: string; method?: string } = {}): Promise<{ status: number; body: string }> {
  return new Promise((done, fail) => {
    const req = request(
      { host: '127.0.0.1', port: dashboard.port, path, method: options.method ?? 'GET', headers: options.host === undefined ? {} : { host: options.host } },
      (res) => {
        let body = '';
        res.on('data', (d: Buffer) => (body += d.toString('utf8')));
        res.on('end', () => done({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', fail);
    req.end();
  });
}

function listenOn(port: number): Promise<Server> {
  return new Promise((done) => {
    const server = createHttpServer();
    server.listen(port, '127.0.0.1', () => done(server));
  });
}

beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'toto-dashboard-'));
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const started = await startDashboard({ port: 0, vaultPath: vault });
  stderr.mockRestore();
  expect(started).not.toBeNull();
  dashboard = started as Dashboard;
});

afterAll(async () => {
  await dashboard.close();
  rmSync(vault, { recursive: true, force: true });
  removeIsolatedEnvs();
});

describe('TOTO_MCP_PORT', () => {
  it('leaves the dashboard off when unset or empty', () => {
    expect(dashboardPort({})).toBeNull();
    expect(dashboardPort({ TOTO_MCP_PORT: '' })).toBeNull();
  });

  it.each([['3099', 3099], ['1', 1], ['65535', 65535], ['007', 7]])('accepts %j as port %i', (raw, port) => {
    expect(dashboardPort({ TOTO_MCP_PORT: raw })).toBe(port);
  });

  it.each([['0'], ['65536'], ['99999'], ['abc'], ['3099x'], ['-1'], ['30 99'], ['123456']])('rejects %j with one warning', (raw) => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(dashboardPort({ TOTO_MCP_PORT: raw })).toBeNull();
      expect(stderr).toHaveBeenCalledTimes(1);
    } finally {
      stderr.mockRestore();
    }
  });
});

describe('routes and the Host allowlist', () => {
  it('serves the dashboard page at 127.0.0.1 and localhost', async () => {
    const page = await get('/dashboard');
    expect(page.status).toBe(200);
    expect(page.body).toContain('<html');
    expect((await get('/dashboard', { host: `localhost:${String(dashboard.port)}` })).status).toBe(200);
  });

  it('serves the other GET routes', async () => {
    expect((await get('/vault/signal')).status).toBe(200);
    const record = join(vault, 'Council', 'Congressional-Records', '2026-10-04-x.md');
    mkdirSync(dirname(record), { recursive: true });
    writeFileSync(record, 'record body');
    expect(await get('/dashboard/record?type=council&file=2026-10-04-x.md')).toEqual({ status: 200, body: 'record body' });
    expect((await get('/vault/reversed')).status).toBe(400);
  });

  it.each([['evil.example'], ['127.0.0.1'], [`127.0.0.1:${String(1)}`], ['[::1]']])('rejects Host %j with 403', async (host) => {
    expect((await get('/dashboard', { host })).status).toBe(403);
  });

  it('answers non-GET with 405 and the removed v1 POST tool routes with 404', async () => {
    expect((await get('/dashboard', { method: 'POST' })).status).toBe(405);
    expect((await get('/vault_write', { method: 'POST' })).status).toBe(404);
    expect((await get('/nope')).status).toBe(404);
  });
});

describe('listen errors', () => {
  it('downgrades a port in use to one warning and no dashboard', async () => {
    const busy = await listenOn(0);
    const address = busy.address();
    const port = address !== null && typeof address === 'object' ? address.port : 0;
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(await startDashboard({ port, vaultPath: vault })).toBeNull();
      expect(stderr.mock.calls.map(([t]) => String(t)).join('')).toContain('EADDRINUSE');
    } finally {
      stderr.mockRestore();
      busy.close();
    }
  });
});

describe('the real entry with TOTO_MCP_PORT set', () => {
  it('serves the dashboard and exits when stdin ends, even with an SSE client connected', async () => {
    const probe = await listenOn(0);
    const address = probe.address();
    const port = address !== null && typeof address === 'object' ? address.port : 0;
    await new Promise((done) => probe.close(done));
    const child = spawn(process.execPath, [ENTRY], { stdio: ['pipe', 'pipe', 'pipe'], env: isolatedEnv({ TOTO_MCP_PORT: String(port) }) });
    let err = '';
    child.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')));
    const exited = new Promise<number | null>((done) => child.on('exit', done));
    await vi.waitFor(() => expect(err).toContain('dashboard at'), { timeout: 10_000, interval: 50 });
    // An SSE client stays connected while stdin closes.
    const sse = request({ host: '127.0.0.1', port, path: '/dashboard/events' });
    sse.on('error', () => undefined);
    await new Promise<void>((done) => {
      sse.on('response', () => done());
      sse.end();
    });
    child.stdin.end();
    expect(await exited).toBe(0);
  }, 20_000);
});

describe('SSE registry close-down (closeAllClients)', () => {
  it('ends every client, empties the registry and clears both timers', () => {
    vi.useFakeTimers();
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const clients = Array.from({ length: 50 }, () => Object.assign(new EventEmitter(), { destroyed: false, write: vi.fn(() => true), end: vi.fn() }));
      for (const c of clients) registerClient(c as unknown as ServerResponse, vault);
      expect(isAtCapacity()).toBe(true);
      expect(vi.getTimerCount()).toBe(2);
      closeAllClients();
      expect(isAtCapacity()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      for (const c of clients) expect(c.end).toHaveBeenCalledTimes(1);
    } finally {
      stderr.mockRestore();
      vi.useRealTimers();
    }
  });
});
