import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ICON_REL,
  MAX_FILE_BYTES,
  MAX_LINE_CHARS,
  assertNoSymlink,
  assertUnderRoot,
  checkPluginLayout,
  checkSkillCopies,
  diffTrees,
  listTree,
  readSkillList,
  removeTree,
  checkLicenseAndIcon,
  isCompletePng,
  syncLicense,
  syncSkills,
} from './plugin-sync-lib.js';

const SKILLS = ['drs', 'p10'];
let root: string;

/** Builds a fixture repo: two source skills (drs has an executable script), a manifest and a server entry. */
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
  writeFileSync(join(dir, 'plugin', 'server', 'index.mts'), "import process from 'node:process';\nvoid process;\n");
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
    writeFileSync(join(root, 'plugin', 'NOTES.md'), 'x');
    expect(problems()).toContain('not allowed in the plugin folder: NOTES.md');
  });
  it('a README.md at the plugin root is allowed', () => {
    writeFileSync(join(root, 'plugin', 'README.md'), '# plugin\n');
    expect(problems()).toEqual([]);
  });
  it('a README.md anywhere else is not', () => {
    writeFileSync(join(root, 'plugin', 'server', 'README.md'), 'x');
    expect(problems()).toContain('only readable .mts files may ship under server/: server/README.md');
  });
  it('symlink in the plugin folder', () => {
    symlinkSync(join(root, '.claude', 'skills', 'p10'), join(root, 'plugin', 'skills', 'linked'));
    expect(() => problems()).toThrow(/symlink/);
  });
  it('file at the 256 KiB per-file limit', () => {
    writeFileSync(join(root, 'plugin', 'server', 'index.mts'), 'x'.repeat(MAX_FILE_BYTES));
    expect(problems()).toContain(`not under ${String(MAX_FILE_BYTES)} bytes (the directory's per-file limit): server/index.mts`);
  });
  it('a file just under the limit passes', () => {
    // In lines (999 characters plus a newline), so only the size is tested, not the minified guard.
    const lines = `${'x'.repeat(999)}\n`.repeat(Math.floor((MAX_FILE_BYTES - 1) / 1000));
    writeFileSync(join(root, 'plugin', 'server', 'index.mts'), lines + 'x'.repeat(MAX_FILE_BYTES - 1 - lines.length));
    expect(statSync(join(root, 'plugin', 'server', 'index.mts')).size).toBe(MAX_FILE_BYTES - 1);
    expect(problems()).toEqual([]);
  });
  it('missing server entry', () => {
    unlinkSync(join(root, 'plugin', 'server', 'index.mts'));
    expect(problems()).toContain('missing server entry: server/index.mts');
  });
  it.each(['index.mjs', 'package.json', 'helper.ts', 'mcp/util.js'])('non-.mts file under server/: %s', (name) => {
    mkdirSync(join(root, 'plugin', 'server', 'mcp'), { recursive: true });
    writeFileSync(join(root, 'plugin', 'server', name), 'x');
    expect(problems()).toContain(`only readable .mts files may ship under server/: server/${name}`);
  });
  it('nested .mts modules under server/ are allowed', () => {
    mkdirSync(join(root, 'plugin', 'server', 'mcp'), { recursive: true });
    writeFileSync(join(root, 'plugin', 'server', 'mcp', 'protocol.mts'), 'export {};\n');
    expect(problems()).toEqual([]);
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

// A minimal complete PNG: signature, a 1x1 IHDR, IEND (CRCs are not checked).
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR', 'latin1'), Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]), Buffer.alloc(4),
  Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]),
]);

describe('spec criterion 2 and the shipped icon and LICENSE (#64)', () => {
  it('allows a PNG icon and a LICENSE at their paths', () => {
    writeFileSync(join(root, 'plugin', ICON_REL), PNG);
    writeFileSync(join(root, 'plugin', 'LICENSE'), 'MIT\n');
    expect(problems()).toEqual([]);
  });
  it('refuses an icon that is not a PNG, or is executable', () => {
    writeFileSync(join(root, 'plugin', ICON_REL), 'not a png');
    expect(problems()).toContain(`not a complete PNG file: ${ICON_REL}`);
    writeFileSync(join(root, 'plugin', ICON_REL), PNG.subarray(0, PNG.length - 12));
    expect(problems()).toContain(`not a complete PNG file: ${ICON_REL}`);
    writeFileSync(join(root, 'plugin', ICON_REL), PNG.subarray(0, 13));
    expect(problems()).toContain(`not a complete PNG file: ${ICON_REL}`);
    writeFileSync(join(root, 'plugin', ICON_REL), PNG);
    chmodSync(join(root, 'plugin', ICON_REL), 0o755);
    expect(problems()).toContain(`the icon must not be executable: ${ICON_REL}`);
  });
  it('exempts only the icon from the line scan (not any file starting with PNG bytes)', () => {
    writeFileSync(join(root, 'plugin', 'server', 'x.mts'), Buffer.concat([PNG, Buffer.from('a'.repeat(MAX_LINE_CHARS + 1))]));
    expect(problems().some((p) => p.includes('looks minified') && p.endsWith('x.mts'))).toBe(true);
  });
  it(`refuses a line longer than ${String(MAX_LINE_CHARS)} characters, accepts one at the limit`, () => {
    writeFileSync(join(root, 'plugin', 'server', 'x.mts'), `${'a'.repeat(MAX_LINE_CHARS)}\n`);
    expect(problems()).toEqual([]);
    writeFileSync(join(root, 'plugin', 'server', 'x.mts'), `${'a'.repeat(MAX_LINE_CHARS + 1)}\n`);
    expect(problems()).toContain(`a line of ${String(MAX_LINE_CHARS + 1)} characters looks minified (limit ${String(MAX_LINE_CHARS)}): server/x.mts`);
  });
  it.each([['package.json'], ['pnpm-lock.yaml'], ['yarn.lock'], ['package-lock.json'], ['bun.lockb']])('refuses %s anywhere, even inside a skill', (name) => {
    writeFileSync(join(root, '.claude', 'skills', 'drs', name), '{}');
    syncSkills(root, SKILLS);
    expect(problems()).toContain(`no package manifest or lockfile may ship: skills/drs/${name}`);
  });
  it('refuses a .min. file, but lock.mts (a real server file) is fine (Arbiter condition 1)', () => {
    writeFileSync(join(root, '.claude', 'skills', 'drs', 'app.min.js'), 'x');
    syncSkills(root, SKILLS);
    expect(problems()).toContain('no minified file may ship: skills/drs/app.min.js');
    rmSync(join(root, '.claude', 'skills', 'drs', 'app.min.js'));
    syncSkills(root, SKILLS);
    writeFileSync(join(root, 'plugin', 'server', 'lock.mts'), 'export {};\n');
    expect(problems()).toEqual([]);
  });
  it('syncs LICENSE from the root and flags a copy that differs', () => {
    writeFileSync(join(root, 'LICENSE'), 'MIT License\n');
    syncLicense(root);
    writeFileSync(join(root, 'plugin', ICON_REL), PNG);
    expect(checkLicenseAndIcon(root)).toEqual([]);
    writeFileSync(join(root, 'plugin', 'LICENSE'), 'changed\n');
    expect(checkLicenseAndIcon(root)).toEqual(['plugin/LICENSE must be a byte copy of the root LICENSE']);
  });
});

describe('the icon (PR #72 review)', () => {
  it('must exist: a deleted icon is a problem', () => {
    writeFileSync(join(root, 'LICENSE'), 'MIT License\n');
    syncLicense(root);
    expect(checkLicenseAndIcon(root)).toEqual(['plugin/.claude-plugin/icon.png is missing']);
  });
  it('the real icon is a complete PNG', () => {
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    expect(isCompletePng(readFileSync(join(repo, 'plugin', ICON_REL)))).toBe(true);
  });
});

describe('spec criterion 10: the marketplace on main installs a valid plugin (Arbiter condition 6)', () => {
  it("resolves marketplace.json's source to a folder that passes the layout check", () => {
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const market = JSON.parse(readFileSync(join(repo, '.claude-plugin', 'marketplace.json'), 'utf-8')) as { plugins: { name: string; source: string }[] };
    const entry = market.plugins.find((p) => p.name === 'toto-wolff');
    expect(entry?.source).toBe('./plugin');
    const folder = join(repo, entry?.source ?? '');
    const skills = readSkillList(join(folder, '.claude-plugin', 'plugin.json'));
    expect(checkPluginLayout(folder, skills)).toEqual([]);
  });
});
