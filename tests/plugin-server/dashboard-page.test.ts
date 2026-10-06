// The dashboard as a page file (2.0.0): dashboard_status writes
// <vault>/.toto-wolff/dashboard.html and returns its path as `page`; each
// vault_write after that refreshes it. No server, no port, no requests.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLineHandler } from '../../plugin/server/mcp/server.mts';
import type { LineHandler } from '../../plugin/server/mcp/server.mts';
import { createRuntime } from '../../plugin/server/runtime.mts';
import { createTools } from '../../plugin/server/tools/index.mts';

const ENV_KEYS = ['HOME', 'XDG_CONFIG_HOME', 'GIT_CONFIG_NOSYSTEM'];
const saved: Record<string, string | undefined> = {};
let root: string;
let vault: string;
let page: string;

function handler(): LineHandler {
  return createLineHandler(createTools(createRuntime({ vault, project: join(root, 'project') })));
}

async function result(handle: LineHandler, name: string, args: unknown): Promise<Record<string, unknown>> {
  const reply = (await handle(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }))) as {
    result?: { content: { text: string }[] };
  };
  expect(reply.result, JSON.stringify(reply)).toBeDefined();
  return JSON.parse(reply.result?.content[0]?.text ?? 'null') as Record<string, unknown>;
}

function git(...args: string[]): string {
  return execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' });
}

// The snapshot time the page shows in its header.
function snapshotOf(html: string): string {
  const match = /id="page-status">snapshot ([^<]+)</.exec(html);
  expect(match).not.toBeNull();
  return match?.[1] ?? '';
}

beforeAll(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  root = mkdtempSync(join(tmpdir(), 'toto-dashboard-page-'));
  vault = join(root, 'vault');
  mkdirSync(join(root, 'home'));
  mkdirSync(join(root, 'project'));
  mkdirSync(vault);
  process.env['HOME'] = join(root, 'home');
  process.env['XDG_CONFIG_HOME'] = join(root, 'home');
  process.env['GIT_CONFIG_NOSYSTEM'] = '1';
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  rmSync(root, { recursive: true, force: true });
});

describe('the dashboard page file', () => {
  it('is not written by a vault_write before any dashboard_status', async () => {
    await result(handler(), 'vault_write', { path: 'Notes/first.md', content: 'first\n' });
    expect(existsSync(join(vault, '.toto-wolff'))).toBe(false);
  });

  it('is written by dashboard_status, which returns its absolute path as `page`', async () => {
    const handle = handler();
    const out = await result(handle, 'dashboard_status', {});
    page = String(out['page']);
    expect(isAbsolute(page)).toBe(true);
    expect(page).toBe(join(vault, '.toto-wolff', 'dashboard.html'));
    expect(out).toHaveProperty('councilSessions');
    expect(out).toHaveProperty('generatedAt');
    expect(existsSync(page)).toBe(true);
    expect(readFileSync(join(vault, '.toto-wolff', '.gitignore'), 'utf8')).toBe('*\n');

    // Each vault_write on this runtime refreshes it.
    const before = snapshotOf(readFileSync(page, 'utf8'));
    await new Promise((r) => setTimeout(r, 5));
    await result(handle, 'vault_write', { path: 'P10-Plans/2026-10-06-marker.md', content: 'Status: approved PAGEMARKER\n' });
    const after = readFileSync(page, 'utf8');
    expect(snapshotOf(after)).not.toBe(before);
    expect(after).toContain('PAGEMARKER');
  });

  it('makes no requests and names no host', () => {
    const html = readFileSync(page, 'utf8');
    for (const needle of ['fetch(', 'EventSource', 'node:http', '127.0.0.1', 'localhost']) expect(html, needle).not.toContain(needle);
  });

  it('never shows up in vault_search or the dashboard recent items', async () => {
    const handle = handler();
    const search = await result(handle, 'vault_search', { query: 'PAGEMARKER' });
    const files = (search['results'] as { file: string }[]).map((r) => r.file);
    expect(files).toEqual([join(vault, 'P10-Plans', '2026-10-06-marker.md')]);
    const stats = await result(handle, 'dashboard_status', {});
    const rest = JSON.stringify({ ...stats, page: undefined });
    expect(rest).not.toContain('dashboard.html');
    expect(rest).not.toContain('DOCTYPE');
  });

  it('stays out of git in a git vault', () => {
    expect(git('status', '--porcelain', '--untracked-files=all')).not.toContain('.toto-wolff');
    expect(git('log', '--name-only', '--format=')).not.toContain('.toto-wolff');
  });
});
