// The six #60 tools through the real server, in both MCP eras, with git
// optional and best effort. One vault per file: the server process serves a
// single vault path (vault_cache.mts asserts it).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer } from '../../plugin/server/mcp/server.mts';
import type { LineHandler } from '../../plugin/server/mcp/server.mts';
import { getCachedVault } from '../../plugin/server/handlers/vault_cache.mts';
import { createRuntime } from '../../plugin/server/runtime.mts';
import { createTools } from '../../plugin/server/tools/index.mts';
import { TOOL_NAMES } from './spawn-env.ts';

const META = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} };
const SERVER_INFO = { 'io.modelcontextprotocol/serverInfo': { name: 'toto-wolff', version: '2.0.0' } };
const ENV_KEYS = ['HOME', 'XDG_CONFIG_HOME', 'GIT_CONFIG_NOSYSTEM', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL', 'TOTO_DRS_CONFIG', 'PATH'];

let root: string;
let vault: string;
let handle: LineHandler;
const saved: Record<string, string | undefined> = {};

const call = (name: string, args: unknown, modern = false): string =>
  JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args, ...(modern ? { _meta: META } : {}) } });

async function tool(name: string, args: unknown, modern = false): Promise<Record<string, unknown>> {
  return (await handle(call(name, args, modern))) as Record<string, unknown>;
}

// The tool's JSON text result, parsed.
async function result(name: string, args: unknown): Promise<unknown> {
  const reply = (await tool(name, args)) as { result?: { content: { text: string }[] } };
  expect(reply.result, JSON.stringify(reply)).toBeDefined();
  return JSON.parse(reply.result?.content[0]?.text ?? 'null') as unknown;
}

function git(...args: string[]): string {
  return execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' });
}

beforeAll(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  root = mkdtempSync(join(tmpdir(), 'toto-tools-'));
  vault = join(root, 'vault');
  mkdirSync(join(root, 'home'));
  // No global git identity or config reaches the vault's git.
  process.env['HOME'] = join(root, 'home');
  process.env['XDG_CONFIG_HOME'] = join(root, 'home');
  process.env['GIT_CONFIG_NOSYSTEM'] = '1';
  for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL']) delete process.env[key];
  writeFileSync(join(root, 'drs.json'), JSON.stringify({ allowed_paths: ['src/'], tenant_namespaces: [], current_tenant: '', halt_patterns: [] }));
  process.env['TOTO_DRS_CONFIG'] = join(root, 'drs.json');
  handle = createServer(createTools(createRuntime({ TOTO_VAULT_PATH: vault, HOME: join(root, 'home'), CLAUDE_PROJECT_DIR: join(root, 'project') })));
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  rmSync(root, { recursive: true, force: true });
});

describe('the six tools in both eras', () => {
  it('lists exactly the six tools, vault_write with { path, content }', async () => {
    const reply = (await handle(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))) as { result: { tools: { name: string; inputSchema: { required?: string[] } }[] } };
    expect(reply.result.tools.map((t) => t.name)).toEqual(TOOL_NAMES);
    expect(reply.result.tools[0]?.inputSchema.required).toEqual(['path', 'content']);
  });

  it('answers a legacy call with the v1 text shape only', async () => {
    expect(await tool('vault_write', { path: 'Notes/eras.md', content: 'era text\n' })).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { content: [{ type: 'text', text: '{"path":"Notes/eras.md"}' }] },
    });
  });

  it('answers a modern call with the same text plus resultType and serverInfo', async () => {
    expect(await tool('vault_search', { query: 'era text' }, true)).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        content: [{ type: 'text', text: JSON.stringify({ results: [{ file: join(vault, 'Notes', 'eras.md'), line: 1, text: 'era text' }], truncated: false }) }],
        resultType: 'complete',
        _meta: SERVER_INFO,
      },
    });
  });

  // The #60 tools; the graph tools are covered in graph-tools.test.ts.
  it.each(TOOL_NAMES.slice(0, 6).map((name) => [name]))('%s answers in both eras', async (name) => {
    const args: Record<string, unknown> = {
      vault_write: { path: 'Notes/each.md', content: 'x' },
      vault_search: { query: 'x' },
      drs_check: { tool: 'Write', target_path: 'src/a.ts' },
      subagent_list: {},
      dashboard_status: {},
      score_confidence: { ruling: 'ship it' },
    };
    for (const modern of [false, true]) {
      const reply = (await tool(name, args[name], modern)) as { result?: Record<string, unknown> };
      expect(reply.result?.['content'], `${name} modern=${String(modern)}`).toBeDefined();
      expect(reply.result?.['resultType']).toBe(modern ? 'complete' : undefined);
    }
  });

  it.each([
    ['vault_write', {}],
    ['vault_write', { path: 'a.md' }],
    ['vault_write', { path: '../escape.md', content: 'x' }],
    ['vault_write', { path: '/abs.md', content: 'x' }],
    ['vault_search', {}],
    ['vault_search', { query: 'q'.repeat(501) }],
    ['drs_check', { tool: 'Delete' }],
    ['drs_check', { tool: 'Write' }],
    ['subagent_list', { scope: 'everyone' }],
    ['score_confidence', {}],
    ['score_confidence', { ruling: '' }],
  ])('%s %j is invalid input (-32602), in both eras', async (name, args) => {
    expect(await tool(name, args)).toMatchObject({ error: { code: -32602 } });
    expect(await tool(name, args, true)).toMatchObject({ error: { code: -32602 } });
  });
});

describe('git is optional and best effort', () => {
  it('writes without committing, or trying to, when the vault is not a git repository', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(await result('vault_write', { path: 'Notes/plain.md', content: 'plain\n' })).toEqual({ path: 'Notes/plain.md' });
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
    }
    expect(readFileSync(join(vault, 'Notes', 'plain.md'), 'utf8')).toBe('plain\n');
    expect(existsSync(join(vault, '.git'))).toBe(false);
  });

  it('commits each write when the vault is a git repository', async () => {
    git('init', '-q');
    // Without an explicit identity git must fail, never guess one from the host.
    git('config', 'user.useConfigOnly', 'true');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 't');
    await result('vault_write', { path: 'Notes/committed.md', content: 'c\n' });
    expect(git('log', '--format=%s')).toContain('committed.md');
  });

  it('keeps a write when the commit fails (no git identity), warns once, and does not wedge later writes', async () => {
    git('config', '--unset', 'user.email');
    git('config', '--unset', 'user.name');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(await result('vault_write', { path: 'Notes/no-identity.md', content: 'n\n' })).toEqual({ path: 'Notes/no-identity.md' });
      expect(readFileSync(join(vault, 'Notes', 'no-identity.md'), 'utf8')).toBe('n\n');
      expect(stderr.mock.calls.filter(([text]) => String(text).includes('vault commit skipped'))).toHaveLength(1);
    } finally {
      stderr.mockRestore();
    }
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 't');
    await result('vault_write', { path: 'Notes/after.md', content: 'a\n' });
    expect(git('log', '-1', '--format=%s')).toContain('after.md');
  });

  it('treats a missing git binary as "not a repository"', async () => {
    const empty = join(root, 'empty-bin');
    mkdirSync(empty, { recursive: true });
    process.env['PATH'] = empty;
    try {
      expect(await result('vault_write', { path: 'Notes/no-git.md', content: 'g\n' })).toEqual({ path: 'Notes/no-git.md' });
    } finally {
      process.env['PATH'] = saved['PATH'];
    }
    expect(git('log', '--format=%s')).not.toContain('no-git.md');
  });

  it('keeps the write when git itself fails (not a "not a repository" error): one warning', async () => {
    const fakeBin = join(root, 'fake-bin');
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(join(fakeBin, 'git'), '#!/bin/sh\nexit 2\n', { mode: 0o755 });
    process.env['PATH'] = `${fakeBin}:${saved['PATH'] ?? ''}`;
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(await result('vault_write', { path: 'Notes/git-broken.md', content: 'b\n' })).toEqual({ path: 'Notes/git-broken.md' });
      expect(stderr.mock.calls.filter(([text]) => String(text).includes('vault commit skipped'))).toHaveLength(1);
    } finally {
      stderr.mockRestore();
      process.env['PATH'] = saved['PATH'];
    }
  });
});

describe('drs_check override audit', () => {
  const override = { tool: 'Write', target_path: 'outside/file.ts', message_before: 'override drs: test' };

  it('honors an override once its audit file is on disk, even when the commit fails (no git identity)', async () => {
    git('config', '--unset', 'user.email');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(await result('drs_check', override)).toMatchObject({ allowed: true, override: true, overrideReason: 'test' });
    } finally {
      stderr.mockRestore();
      git('config', 'user.email', 't@example.com');
    }
    expect(readdirSync(join(vault, 'DRS')).some((f) => f.endsWith('-drs-override.md'))).toBe(true);
  });

  it('refuses the override when the audit write itself fails', async () => {
    rmSync(join(vault, 'DRS'), { recursive: true, force: true });
    writeFileSync(join(vault, 'DRS'), 'a file where the DRS folder should be');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const out = await result('drs_check', override);
      expect(out).toMatchObject({ allowed: false, ruleFired: 2 });
      expect((out as { override?: boolean }).override).toBeUndefined();
    } finally {
      stderr.mockRestore();
      rmSync(join(vault, 'DRS'), { force: true });
    }
  });
});

describe('the shared vault cache', () => {
  it('fails loudly if a second vault path is asked for in one process', () => {
    expect(() => getCachedVault(join(root, 'another-vault'))).toThrow('one server process serves one vault path');
  });
});
