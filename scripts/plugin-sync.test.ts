import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BUNDLE_BANNER,
  MAX_FILE_BYTES,
  PACKAGES,
  assertNoSymlink,
  assertUnderRoot,
  checkPluginLayout,
  checkSkillCopies,
  diffTrees,
  listTree,
  readSkillList,
  removeTree,
  syncSkills,
} from './plugin-sync-lib.js';

const SKILLS = ['drs', 'p10'];
let root: string;

/** Builds a fixture repo: two source skills (drs has an executable script), a manifest and a bundle. */
function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-sync-test-'));
  mkdirSync(join(dir, '.claude', 'skills', 'drs', 'bin'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'skills', 'drs', 'SKILL.md'), '---\nname: drs\ndescription: d\n---\n');
  writeFileSync(join(dir, '.claude', 'skills', 'drs', 'bin', 'drs-check.sh'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(dir, '.claude', 'skills', 'drs', 'bin', 'drs-check.sh'), 0o755);
  mkdirSync(join(dir, '.claude', 'skills', 'p10'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'skills', 'p10', 'SKILL.md'), '---\nname: p10\ndescription: p\n---\n');
  mkdirSync(join(dir, 'plugin', '.claude-plugin'), { recursive: true });
  writeManifest(dir, SKILLS.map((s) => `./skills/${s}`));
  mkdirSync(join(dir, 'plugin', 'server'), { recursive: true });
  writeFileSync(join(dir, 'plugin', 'server', 'index.mjs'), `${BUNDLE_BANNER} from "node:module";\nconsole.log(1);\n`);
  return dir;
}

function writeManifest(dir: string, skills: unknown): void {
  writeFileSync(join(dir, 'plugin', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 't', skills }));
}

function problems(): string[] {
  return [...checkPluginLayout(join(root, 'plugin'), SKILLS), ...checkSkillCopies(root, SKILLS)];
}

beforeEach(() => {
  root = makeFixture();
  syncSkills(root, SKILLS);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('a freshly synced plugin folder', () => {
  it('passes every check and keeps the exec bit on drs-check.sh', () => {
    expect(problems()).toEqual([]);
    expect(statSync(join(root, 'plugin', 'skills', 'drs', 'bin', 'drs-check.sh')).mode & 0o111).not.toBe(0);
  });
});

describe('drift in a skill copy is caught', () => {
  const copied = (): string => join(root, 'plugin', 'skills', 'drs', 'bin', 'drs-check.sh');

  it('flipped byte', () => {
    writeFileSync(copied(), '#!/bin/sh\nexit 1\n');
    expect(problems()).toContain('skills/drs/bin/drs-check.sh: bytes');
  });
  it('lost exec bit', () => {
    chmodSync(copied(), 0o644);
    expect(problems()).toContain('skills/drs/bin/drs-check.sh: mode');
  });
  it('deleted file', () => {
    unlinkSync(copied());
    expect(problems()).toContain('skills/drs/bin/drs-check.sh: missing');
  });
  it('extra file in a skill', () => {
    writeFileSync(join(root, 'plugin', 'skills', 'p10', 'stray.md'), 'x');
    expect(problems()).toContain('skills/p10/stray.md: extra');
  });
});

describe('the plugin folder layout is enforced', () => {
  it('extra top-level file', () => {
    writeFileSync(join(root, 'plugin', 'README.md'), 'x');
    expect(problems()).toContain('not allowed in the plugin folder: README.md');
  });
  it('symlink in the plugin folder', () => {
    symlinkSync(join(root, '.claude', 'skills', 'p10'), join(root, 'plugin', 'skills', 'linked'));
    expect(() => problems()).toThrow(/symlink/);
  });
  it('file over the 1 MiB inspection limit', () => {
    writeFileSync(join(root, 'plugin', 'server', 'index.mjs'), `${BUNDLE_BANNER}\n${'x'.repeat(MAX_FILE_BYTES)}`);
    expect(problems().some((p) => p.startsWith(`over ${String(MAX_FILE_BYTES)} bytes`))).toBe(true);
  });
  it('missing bundle', () => {
    unlinkSync(join(root, 'plugin', 'server', 'index.mjs'));
    expect(problems()).toContain('missing bundle: server/index.mjs');
  });
  it('bundle bundled twice (two banners)', () => {
    writeFileSync(join(root, 'plugin', 'server', 'index.mjs'), `${BUNDLE_BANNER};\n${BUNDLE_BANNER};\n`);
    expect(problems().some((p) => p.includes('2 esbuild banners'))).toBe(true);
  });
});

describe('sources and manifests are validated', () => {
  it('symlink in a source skill is refused when syncing', () => {
    symlinkSync(join(root, '.claude', 'skills', 'drs', 'SKILL.md'), join(root, '.claude', 'skills', 'p10', 'alias.md'));
    expect(() => syncSkills(root, SKILLS)).toThrow(/symlink/);
  });
  it('a manifest naming a skill with no source is refused when syncing', () => {
    expect(() => syncSkills(root, ['drs', 'nope'])).toThrow(/not a directory/);
  });
  it('a manifest entry containing .. is rejected', () => {
    writeManifest(root, ['./skills/drs', './skills/../../etc']);
    expect(() => readSkillList(join(root, 'plugin', '.claude-plugin', 'plugin.json'))).toThrow(/\.\/skills\/<name>/);
  });
  it('a manifest in the old ./.claude/skills/<name> form is rejected, not loosened', () => {
    writeManifest(root, ['./.claude/skills/drs']);
    expect(() => readSkillList(join(root, 'plugin', '.claude-plugin', 'plugin.json'))).toThrow(/\.\/skills\/<name>/);
  });
  it('a valid manifest yields the skill names', () => {
    expect(readSkillList(join(root, 'plugin', '.claude-plugin', 'plugin.json'))).toEqual(SKILLS);
  });
  it('an empty skill directory is refused', () => {
    rmSync(join(root, '.claude', 'skills', 'p10', 'SKILL.md'));
    expect(() => syncSkills(root, SKILLS)).toThrow(/no files/);
  });
});

describe('path guards', () => {
  it('assertUnderRoot refuses a path outside the root and the root itself', () => {
    expect(() => assertUnderRoot(root, '../outside')).toThrow(/outside/);
    expect(() => assertUnderRoot(root, '.')).toThrow(/root itself/);
    expect(assertUnderRoot(root, 'plugin/server')).toBe(join(root, 'plugin', 'server'));
  });
  it('removeTree refuses to delete through a symlink and leaves its target alone', () => {
    const target = join(root, '.claude', 'skills', 'p10');
    symlinkSync(target, join(root, 'plugin', 'danger'));
    expect(() => removeTree(root, join('plugin', 'danger'))).toThrow(/symlink/);
    expect(statSync(join(target, 'SKILL.md')).isFile()).toBe(true);
  });
  it('assertNoSymlink passes for a missing path', () => {
    expect(() => assertNoSymlink(join(root, 'does-not-exist'))).not.toThrow();
  });
  it('diffTrees reports nothing for identical trees', () => {
    const tree = listTree(join(root, '.claude', 'skills', 'drs'));
    expect(diffTrees(tree, tree)).toEqual([]);
  });
});

describe('PACKAGES', () => {
  it('is core then mcp-server (core must build first)', () => {
    expect(PACKAGES).toEqual(['core', 'mcp-server']);
  });
});
