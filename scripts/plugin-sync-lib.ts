/**
 * Shared logic for the plugin/ folder: the Claude Code plugin ships only
 * plugin/ (its manifest, copies of the skills it lists, and one minified MCP
 * server bundle), never the whole repository.
 *
 * Sources of truth stay where contributors edit them: skills in
 * .claude/skills/<name>/, server code in packages/. plugin/ is a generated
 * artifact. sync-plugin.ts regenerates it; check-plugin-sync.ts proves the
 * committed copy matches a fresh regeneration, failing closed on any
 * difference in bytes or exec bit, on missing or extra files, and on symlinks
 * (a symlink pointing outside the plugin folder ships dangling in an
 * installed copy, so none are allowed anywhere in plugin/).
 *
 * Every delete goes through removeTree, which refuses paths outside the repo
 * root and refuses symlinks. Paths are derived from this file's own location,
 * never from environment variables or CLI arguments; functions take a root
 * parameter only so tests can point them at a disposable fixture.
 */

import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The shipped plugin folder, relative to the repo root. */
export const PLUGIN_DIR = 'plugin';
/** The plugin manifest, relative to the plugin folder. */
export const MANIFEST_REL = join('.claude-plugin', 'plugin.json');
/** The minified MCP server bundle, relative to the plugin folder. */
export const BUNDLE_REL = join('server', 'index.mjs');
/** Where the real skill files live, relative to the repo root. */
export const SKILLS_SOURCE_DIR = join('.claude', 'skills');

/** Upper bound on skills a manifest may list; the plugin ships 7 today. */
export const MAX_SKILLS = 16;
/** Upper bound on files walked in any one tree; a skill has a handful. */
export const MAX_FILES = 500;
/** Upper bound on directory depth walked in any one tree. */
export const MAX_DEPTH = 8;
/** The plugin directory's text-inspection limit: a larger file cannot be reviewed. */
export const MAX_FILE_BYTES = 1024 * 1024;
/** The esbuild banner, which must appear exactly once (twice means the bundle was bundled again). */
export const BUNDLE_BANNER = 'import { createRequire as __totoCreateRequire }';

/** Build order: mcp-server's tsc consumes core's emitted .d.ts files, so core builds first. */
export const PACKAGES = ['core', 'mcp-server'] as const;

export type Result = { ok: true } | { ok: false; message: string };

export interface TreeEntry {
  rel: string;
  exec: boolean;
  sha256: string;
}

export interface Finding {
  kind: 'missing' | 'extra' | 'bytes' | 'mode';
  rel: string;
}

/** Returns `p` resolved, throwing unless it lies strictly inside `root`. */
export function assertUnderRoot(root: string, p: string): string {
  assert(isAbsolute(root), `root must be absolute: ${root}`);
  const resolved = resolve(root, p);
  const rel = relative(root, resolved);
  assert(rel.length > 0, `refusing ${resolved}: it is the root itself, not a path under it`);
  assert(!rel.startsWith('..') && !isAbsolute(rel), `refusing ${resolved}: outside ${root}`);
  return resolved;
}

/** Throws if `p` exists and is a symlink. A missing path passes (nothing to refuse). */
export function assertNoSymlink(p: string): void {
  assert(p.length > 0, 'path must be non-empty');
  if (existsSync(p) || isDanglingSymlink(p)) {
    assert(!lstatSync(p).isSymbolicLink(), `refusing ${p}: it is a symlink`);
  }
}

function isDanglingSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Deletes `p` recursively, only if it is under `root` and not a symlink. */
export function removeTree(root: string, p: string): void {
  const target = assertUnderRoot(root, p);
  assertNoSymlink(target);
  rmSync(target, { recursive: true, force: true });
  assert(!existsSync(target), `failed to delete ${target}`);
}

/**
 * Reads the skill names a plugin manifest lists. Each entry must be
 * `./skills/<name>` (lowercase, digits, hyphens), with 1 to MAX_SKILLS
 * entries and no duplicates; anything else throws.
 */
export function readSkillList(manifestPath: string): string[] {
  assert(existsSync(manifestPath), `manifest not found: ${manifestPath}`);
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  assert(isRecord(parsed), 'manifest must be a JSON object');
  const skills = parsed['skills'];
  assert(Array.isArray(skills), 'manifest "skills" must be an array');
  assert(skills.length >= 1 && skills.length <= MAX_SKILLS, `manifest must list 1 to ${String(MAX_SKILLS)} skills`);
  const names: string[] = [];
  // Bounded: skills.length <= MAX_SKILLS (asserted above).
  for (const entry of skills) {
    assert(typeof entry === 'string', 'every skills entry must be a string');
    const match = /^\.\/skills\/([a-z0-9-]+)$/.exec(entry);
    assert(match?.[1] !== undefined, `skills entry must look like ./skills/<name>: ${entry}`);
    names.push(match[1]);
  }
  assert(new Set(names).size === names.length, 'manifest lists a skill more than once');
  return names;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Lists every regular file under `dir` with its path relative to `dir`, exec
 * bit and sha256, sorted by path. Walks iteratively (no recursion) and throws
 * on a symlink, a non-regular file, an empty tree, or a tree past
 * MAX_FILES files or MAX_DEPTH levels.
 */
export function listTree(dir: string): TreeEntry[] {
  assert(existsSync(dir) && statSync(dir).isDirectory(), `not a directory: ${dir}`);
  assertNoSymlink(dir);
  const entries: TreeEntry[] = [];
  const stack: { path: string; depth: number }[] = [{ path: dir, depth: 0 }];
  // Bounded: every file adds one entry (<= MAX_FILES) and every directory is at depth <= MAX_DEPTH.
  while (stack.length > 0) {
    const current = stack.pop();
    assert(current !== undefined, 'walk stack underflow');
    assert(current.depth <= MAX_DEPTH, `tree deeper than ${String(MAX_DEPTH)} levels: ${current.path}`);
    for (const name of readdirSync(current.path)) {
      const full = join(current.path, name);
      const info = lstatSync(full);
      assert(!info.isSymbolicLink(), `symlink not allowed: ${full}`);
      if (info.isDirectory()) {
        stack.push({ path: full, depth: current.depth + 1 });
        continue;
      }
      assert(info.isFile(), `not a regular file: ${full}`);
      entries.push({ rel: relative(dir, full), exec: (info.mode & 0o111) !== 0, sha256: sha256Of(full) });
      assert(entries.length <= MAX_FILES, `tree has more than ${String(MAX_FILES)} files: ${dir}`);
    }
  }
  assert(entries.length > 0, `tree has no files: ${dir}`);
  return entries.sort((a, b) => a.rel.localeCompare(b.rel));
}

function sha256Of(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/**
 * Replaces `dst` with a copy of `src`. copyFileSync keeps each file's mode,
 * so an exec bit survives; the closing diffTrees assertion fails the copy if
 * any file's bytes or exec bit did not (for example on a filesystem that
 * drops modes).
 */
export function copySkill(root: string, src: string, dst: string): void {
  const sourceFiles = listTree(src);
  removeTree(root, dst);
  // Bounded: listTree returns at most MAX_FILES entries.
  for (const entry of sourceFiles) {
    const from = join(src, entry.rel);
    const to = assertUnderRoot(root, join(dst, entry.rel));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  }
  assert(diffTrees(sourceFiles, listTree(dst)).length === 0, `copy of ${src} does not match its source`);
}

/** Compares two trees: files only in `expected` are missing, only in `actual` are extra. */
export function diffTrees(expected: TreeEntry[], actual: TreeEntry[]): Finding[] {
  assert(expected.length <= MAX_FILES && actual.length <= MAX_FILES, 'tree too large to compare');
  const actualByRel = new Map(actual.map((e) => [e.rel, e]));
  const findings: Finding[] = [];
  // Bounded: expected.length <= MAX_FILES.
  for (const e of expected) {
    const a = actualByRel.get(e.rel);
    if (a === undefined) findings.push({ kind: 'missing', rel: e.rel });
    else if (a.sha256 !== e.sha256) findings.push({ kind: 'bytes', rel: e.rel });
    else if (a.exec !== e.exec) findings.push({ kind: 'mode', rel: e.rel });
    actualByRel.delete(e.rel);
  }
  // Bounded: at most actual.length (<= MAX_FILES) entries remain.
  for (const rel of actualByRel.keys()) findings.push({ kind: 'extra', rel });
  assert(findings.length <= expected.length + actual.length, 'more findings than files');
  return findings;
}

/**
 * Checks the plugin folder's shape: only the manifest, the bundle and the
 * listed skills may exist; no file may exceed MAX_FILE_BYTES; the bundle must
 * exist and carry the esbuild banner exactly once. Returns the problems found.
 */
export function checkPluginLayout(pluginRoot: string, skills: string[]): string[] {
  assert(isAbsolute(pluginRoot), `plugin root must be absolute: ${pluginRoot}`);
  assert(skills.length >= 1 && skills.length <= MAX_SKILLS, 'skill list out of range');
  const allowedSkillDirs = new Set(skills.map((name) => join('skills', name)));
  const problems: string[] = [];
  // Bounded: listTree returns at most MAX_FILES entries.
  for (const entry of listTree(pluginRoot)) {
    const inSkill = [...allowedSkillDirs].some((d) => entry.rel.startsWith(d + sep));
    if (entry.rel !== MANIFEST_REL && entry.rel !== BUNDLE_REL && !inSkill) {
      problems.push(`not allowed in the plugin folder: ${entry.rel}`);
    }
    if (statSync(join(pluginRoot, entry.rel)).size > MAX_FILE_BYTES) {
      problems.push(`over ${String(MAX_FILE_BYTES)} bytes (the directory cannot inspect it): ${entry.rel}`);
    }
  }
  const bundle = join(pluginRoot, BUNDLE_REL);
  if (!existsSync(bundle)) {
    problems.push(`missing bundle: ${BUNDLE_REL}`);
  } else {
    const banners = readFileSync(bundle, 'utf-8').split(BUNDLE_BANNER).length - 1;
    if (banners !== 1) problems.push(`bundle has ${String(banners)} esbuild banners, expected exactly 1 (bundled twice?)`);
  }
  return problems;
}

/** Compares every listed skill's source with its copy in the plugin folder. */
export function checkSkillCopies(root: string, skills: string[]): string[] {
  assert(isAbsolute(root), `root must be absolute: ${root}`);
  assert(skills.length >= 1 && skills.length <= MAX_SKILLS, 'skill list out of range');
  const problems: string[] = [];
  // Bounded: skills.length <= MAX_SKILLS.
  for (const name of skills) {
    const src = join(root, SKILLS_SOURCE_DIR, name);
    const dst = join(root, PLUGIN_DIR, 'skills', name);
    if (!existsSync(dst)) {
      problems.push(`skill not copied into the plugin folder: ${name}`);
      continue;
    }
    // Bounded: diffTrees returns at most 2 * MAX_FILES findings.
    for (const f of diffTrees(listTree(src), listTree(dst))) problems.push(`skills/${name}/${f.rel}: ${f.kind}`);
  }
  return problems;
}

/** Copies every listed skill from its source into the plugin folder. */
export function syncSkills(root: string, skills: string[]): void {
  assert(isAbsolute(root), `root must be absolute: ${root}`);
  assert(skills.length >= 1 && skills.length <= MAX_SKILLS, 'skill list out of range');
  // Bounded: skills.length <= MAX_SKILLS.
  for (const name of skills) {
    copySkill(root, join(root, SKILLS_SOURCE_DIR, name), join(root, PLUGIN_DIR, 'skills', name));
  }
}

/**
 * Deletes both packages' dist/ and tsconfig.tsbuildinfo and the plugin's
 * server/ folder, then builds core and mcp-server in that order. Deleting
 * tsbuildinfo matters: a stale one lets tsc skip emitting, which is how the
 * old in-place bundle ended up bundled twice.
 */
export function rebuildBundle(root: string): Result {
  assert(isAbsolute(root), `root must be absolute: ${root}`);
  assert(PACKAGES[0] === 'core', 'core must build first');
  // Bounded: PACKAGES has 2 entries.
  for (const pkg of PACKAGES) {
    removeTree(root, join('packages', pkg, 'dist'));
    removeTree(root, join('packages', pkg, 'tsconfig.tsbuildinfo'));
  }
  removeTree(root, join(PLUGIN_DIR, 'server'));
  // Bounded: PACKAGES has 2 entries.
  for (const pkg of PACKAGES) {
    const build = spawnSync('pnpm', ['-C', join('packages', pkg), 'build'], { cwd: root, encoding: 'utf-8' });
    if (build.error) return { ok: false, message: `could not spawn the ${pkg} build: ${build.error.message}` };
    if (build.status !== 0) return { ok: false, message: `${pkg} build failed (exit ${String(build.status)}):\n${build.stderr}` };
  }
  const bundle = join(root, PLUGIN_DIR, BUNDLE_REL);
  if (!existsSync(bundle) || statSync(bundle).size === 0) {
    return { ok: false, message: `the build did not produce ${join(PLUGIN_DIR, BUNDLE_REL)}` };
  }
  return { ok: true };
}

/**
 * The drift signal: any modified, deleted or untracked path under `rel`
 * means the committed plugin folder differs from what was just regenerated.
 * A spawn error or non-zero exit is ambiguous and fails closed.
 */
export function compareAgainstCommitted(root: string, rel: string): Result {
  const target = assertUnderRoot(root, rel);
  assert(existsSync(target), `nothing to compare at ${target}`);
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all', '--', rel], {
    cwd: root,
    encoding: 'utf-8',
  });
  if (status.error) return { ok: false, message: `could not run git status: ${status.error.message}; failing closed` };
  if (status.status !== 0) return { ok: false, message: `git status exited ${String(status.status)}; failing closed` };
  const changes = status.stdout.trim();
  return changes.length === 0 ? { ok: true } : { ok: false, message: `${rel} differs from the committed copy:\n${changes}` };
}
