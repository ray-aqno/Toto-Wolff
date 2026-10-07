// The server's settings come from its arguments (plugin.json passes
// --vault ${user_config.vault_path}); it reads no environment variables.
import { spawn } from 'node:child_process';
import { connect, createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { configFromArgs, resolveVaultPath } from '../../plugin/server/runtime.mts';
import { isolatedEnv, removeIsolatedEnvs, serverArgs } from './spawn-env.ts';

const ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), '../../plugin/server/index.mts');

// A port nothing listens on: bound once by the test, then released.
function freePort(): Promise<number> {
  return new Promise((done) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = address !== null && typeof address === 'object' ? address.port : 0;
      probe.close(() => done(port));
    });
  });
}

// Whether a TCP connection to 127.0.0.1:port succeeds.
function accepts(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('error', () => done(false));
  });
}

describe('configFromArgs', () => {
  it('reads --vault and --project', () => {
    expect(configFromArgs(['--vault', '/v', '--project', '/p'])).toEqual({ vault: '/v', project: '/p' });
  });

  it('leaves out empty values and unsubstituted references', () => {
    expect(configFromArgs(['--vault', '', '--project', '${CLAUDE_PROJECT_DIR}'])).toEqual({});
    expect(configFromArgs(['--vault', '${user_config.vault_path}'])).toEqual({});
  });

  it('refuses an unknown flag or a flag without a value', () => {
    expect(() => configFromArgs(['--port', '3099'])).toThrow('unknown argument: --port');
    expect(() => configFromArgs(['--vault'])).toThrow('unknown argument: --vault');
  });
});

describe('resolveVaultPath', () => {
  it('needs a configured vault folder: no home-folder default', () => {
    expect(() => resolveVaultPath({})).toThrow('set it in /plugin > toto-wolff > Configure');
    expect(resolveVaultPath({ vault: '/v/vault' })).toBe('/v/vault');
  });
});

describe('the environment is never read', () => {
  afterAll(removeIsolatedEnvs);

  it('ignores a stray TOTO_WOLFF_PORT: the server answers over stdio and no listener starts', async () => {
    const port = await freePort();
    const child = spawn(process.execPath, [ENTRY, ...serverArgs()], { stdio: ['pipe', 'pipe', 'pipe'], env: isolatedEnv({ TOTO_WOLFF_PORT: String(port) }) });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')));
    const exited = new Promise<number | null>((done) => child.on('exit', done));
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n');
    const until = Date.now() + 10_000;
    while (!out.includes('"id":1') && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
    expect(out).toContain('dashboard_status');
    expect(await accepts(port)).toBe(false);
    child.stdin.end();
    expect(await exited).toBe(0);
    expect(err).toBe('');
  }, 20_000);

  it('ignores TOTO_WOLFF_VAULT: without --vault the server stops with one line', async () => {
    const child = spawn(process.execPath, [ENTRY], { stdio: ['pipe', 'pipe', 'pipe'], env: isolatedEnv({ TOTO_WOLFF_VAULT: '/tmp/toto-wolff-env-vault' }) });
    let err = '';
    child.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')));
    const exited = new Promise<number | null>((done) => child.on('exit', done));
    child.stdin.end();
    expect(await exited).not.toBe(0);
    expect(err).toContain('no vault folder');
  }, 20_000);
});
