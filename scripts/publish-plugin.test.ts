// scripts/publish-plugin.sh on temp git repos (#64): the publish workflow's
// logic, tested here because the workflow itself can only run from main.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), 'publish-plugin.sh');
const dirs: string[] = [];

function temp(): string {
  const d = mkdtempSync(join(tmpdir(), 'publish-plugin-'));
  dirs.push(d);
  return d;
}

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: dir } });
}

// A release's plugin/ folder at `version`, with one file whose text is `marker`.
function source(version: string, marker: string): string {
  const src = temp();
  mkdirSync(join(src, '.claude-plugin'), { recursive: true });
  writeFileSync(join(src, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'toto-wolff', version }));
  mkdirSync(join(src, 'server'));
  writeFileSync(join(src, 'server', 'index.mts'), `// ${marker}\n`);
  writeFileSync(join(src, 'LICENSE'), 'MIT\n');
  return src;
}

// A checkout of branch `plugin`: the spike's history, or an empty new repo.
function dest(withSpike: boolean): string {
  const d = temp();
  git(d, 'init', '-q', '-b', 'plugin');
  if (withSpike) {
    writeFileSync(join(d, 'hello.md'), 'spike\n');
    git(d, 'add', '-A');
    git(d, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'spike');
  }
  return d;
}

function publish(tag: string, src: string, d: string): { status: number | null; out: string } {
  const r = spawnSync('bash', [SCRIPT, tag, src, d], { encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const subjects = (d: string): string[] => git(d, 'log', '--format=%s').trim().split('\n');

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('publish-plugin.sh', () => {
  it('publishes onto the spike as a forward commit, replacing its contents', () => {
    const d = dest(true);
    const r = publish('v2.0.0', source('2.0.0', 'two'), d);
    expect(r.status, r.out).toBe(0);
    expect(subjects(d)).toEqual(['release v2.0.0', 'spike']);
    expect(existsSync(join(d, 'hello.md'))).toBe(false);
    expect(readFileSync(join(d, 'server', 'index.mts'), 'utf8')).toBe('// two\n');
    expect(git(d, 'log', '-1', '--format=%an')).toBe('github-actions[bot]\n');
  });

  it('makes the first commit on a new orphan branch', () => {
    const d = dest(false);
    expect(publish('v2.0.0', source('2.0.0', 'two'), d).status).toBe(0);
    expect(subjects(d)).toEqual(['release v2.0.0']);
  });

  it('adds a later tag as another forward commit, and a rollback to the older tag as a forward commit too', () => {
    const d = dest(true);
    publish('v2.0.0', source('2.0.0', 'two'), d);
    publish('v2.1.0', source('2.1.0', 'two-one'), d);
    expect(publish('v2.0.0', source('2.0.0', 'two'), d).status).toBe(0);
    expect(subjects(d)).toEqual(['release v2.0.0', 'release v2.1.0', 'release v2.0.0', 'spike']);
    expect(readFileSync(join(d, 'server', 'index.mts'), 'utf8')).toBe('// two\n');
  });

  it('exits 0 without a commit when nothing changed', () => {
    const d = dest(true);
    const src = source('2.0.0', 'two');
    publish('v2.0.0', src, d);
    const again = publish('v2.0.0', src, d);
    expect(again.status).toBe(0);
    expect(again.out).toContain('no changes; nothing to commit');
    expect(subjects(d)).toEqual(['release v2.0.0', 'spike']);
  });

  it.each([['2.0.0'], ['v2.0'], ['v2.0.0-rc.1'], ['v2.0.0; echo hi']])('refuses tag %j', (tag) => {
    const d = dest(true);
    const r = publish(tag, source('2.0.0', 'two'), d);
    expect(r.status).toBe(1);
    expect(r.out).toContain('tag must look like v1.2.3');
    expect(subjects(d)).toEqual(['spike']);
  });

  it('refuses a plugin.json version that does not match the tag', () => {
    const d = dest(true);
    const r = publish('v2.0.0', source('2.0.0-dev.1', 'two'), d);
    expect(r.status).toBe(1);
    expect(r.out).toContain('plugin.json version 2.0.0-dev.1 does not match tag v2.0.0');
    expect(existsSync(join(d, 'hello.md'))).toBe(true);
  });

  it('refuses a symbolic link in the plugin folder, before touching the checkout', () => {
    const d = dest(true);
    const src = source('2.0.0', 'two');
    symlinkSync('/etc/hostname', join(src, 'server', 'link'));
    const r = publish('v2.0.0', src, d);
    expect(r.status).toBe(1);
    expect(r.out).toContain('refusing a symbolic link');
    expect(existsSync(join(d, 'hello.md'))).toBe(true);
  });

  it('never pushes: a checkout with a remote stays unpushed', () => {
    const remote = temp();
    git(remote, 'init', '-q', '--bare');
    const d = dest(true);
    git(d, 'remote', 'add', 'origin', remote);
    git(d, 'push', '-q', 'origin', 'plugin');
    expect(publish('v2.0.0', source('2.0.0', 'two'), d).status).toBe(0);
    expect(git(remote, 'log', '--format=%s', 'plugin').trim()).toBe('spike');
  });
});
