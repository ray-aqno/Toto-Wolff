/**
 * Shared logic for the plugin/ folder: the Claude Code plugin ships only
 * plugin/ (its manifest, copies of the skills it lists, and the readable .mts
 * MCP server under plugin/server/), never the whole repository.
 *
 * Skills keep their source of truth in .claude/skills/<name>/ and are copied
 * into plugin/; the server's source of truth is plugin/server/ itself (Node
 * runs it directly, so there is nothing to build). sync-plugin.ts regenerates
 * the skill copies; check-plugin-sync.ts proves the committed folder has the
 * allowed shape and matches its sources, failing closed on any
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
/** The plugin's own README, the one other file allowed at the plugin root. */
export const README_REL = 'README.md';
/** The MCP server folder, relative to the plugin folder. Only .mts files may ship in it. */
export const SERVER_DIR_REL = 'server';
/** The MCP server entry Claude Code starts, relative to the plugin folder. */
export const SERVER_ENTRY_REL = join(SERVER_DIR_REL, 'index.mts');
/** Where the real skill files live, relative to the repo root. */
export const SKILLS_SOURCE_DIR = join('.claude', 'skills');

/** Upper bound on skills a manifest may list; the plugin ships 8 today. */
export const MAX_SKILLS = 16;
/** Upper bound on files walked in any one tree; a skill has a handful. */
export const MAX_FILES = 500;
/** Upper bound on directory depth walked in any one tree. */
export const MAX_DEPTH = 8;
/** The directory's pre-submission limit: every plugin file must be under 256 KiB. */
export const MAX_FILE_BYTES = 256 * 1024;
/** The plugin icon, the one binary file allowed (its own source of truth). */
export const ICON_REL = join('.claude-plugin', 'icon.png');
/** The plugin's copy of the repository LICENSE, written by sync:plugin. */
export const LICENSE_REL = 'LICENSE';
/** Spec criterion 2's minified-file guard: no text line may be longer. */
export const MAX_LINE_CHARS = 2000;
/** Spec criterion 2: no package manifest or lockfile may ship (exact names, so lock.mts is fine). */
const FORBIDDEN_NAMES = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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
 * Checks the plugin folder's shape: only the manifest, README.md, the listed
 * skills and .mts files under server/ may exist; every file must be under MAX_FILE_BYTES;
 * the server entry must exist. Symlinks already fail listTree. Returns the
 * problems found.
 */
export function checkPluginLayout(pluginRoot: string, skills: string[]): string[] {
  assert(isAbsolute(pluginRoot), `plugin root must be absolute: ${pluginRoot}`);
  assert(skills.length >= 1 && skills.length <= MAX_SKILLS, 'skill list out of range');
  const allowedSkillDirs = skills.map((name) => join('skills', name) + sep);
  const problems: string[] = [];
  // Bounded: listTree returns at most MAX_FILES entries.
  for (const entry of listTree(pluginRoot)) {
    const problem = layoutProblem(entry.rel, allowedSkillDirs);
    if (problem !== null) problems.push(problem);
    problems.push(...contentProblems(pluginRoot, entry));
    if (statSync(join(pluginRoot, entry.rel)).size >= MAX_FILE_BYTES) {
      problems.push(`not under ${String(MAX_FILE_BYTES)} bytes (the directory's per-file limit): ${entry.rel}`);
    }
  }
  if (!existsSync(join(pluginRoot, SERVER_ENTRY_REL))) problems.push(`missing server entry: ${SERVER_ENTRY_REL}`);
  return problems;
}

/** Why one plugin file is not allowed where it is, or null if it is fine. */
function layoutProblem(rel: string, allowedSkillDirs: string[]): string | null {
  assert(rel.length > 0, 'a plugin file has a path');
  if (rel === MANIFEST_REL || rel === README_REL || rel === ICON_REL || rel === LICENSE_REL) return null;
  if (allowedSkillDirs.some((dir) => rel.startsWith(dir))) return null;
  if (rel.startsWith(SERVER_DIR_REL + sep)) {
    return rel.endsWith('.mts') ? null : `only readable .mts files may ship under ${SERVER_DIR_REL}/: ${rel}`;
  }
  return `not allowed in the plugin folder: ${rel}`;
}

/**
 * Spec criterion 2 per file: no package manifest or lockfile (exact names)
 * and no minified file anywhere; the icon must be a non-executable PNG and
 * is the only file exempt from the line scan (by exact path).
 */
function contentProblems(pluginRoot: string, entry: TreeEntry): string[] {
  assert(entry.rel.length > 0, 'a plugin file has a path');
  const name = entry.rel.split(sep).pop() ?? '';
  const problems: string[] = [];
  if (FORBIDDEN_NAMES.includes(name)) problems.push(`no package manifest or lockfile may ship: ${entry.rel}`);
  if (/\.min\./i.test(name)) problems.push(`no minified file may ship: ${entry.rel}`);
  const bytes = readFileSync(join(pluginRoot, entry.rel));
  if (entry.rel === ICON_REL) {
    if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) problems.push(`not a PNG file: ${entry.rel}`);
    if (entry.exec) problems.push(`the icon must not be executable: ${entry.rel}`);
    return problems;
  }
  // Bounded: one pass over a file under MAX_FILE_BYTES.
  const longest = bytes.toString('utf-8').split('\n').reduce((m, line) => Math.max(m, line.length), 0);
  if (longest > MAX_LINE_CHARS) problems.push(`a line of ${String(longest)} characters looks minified (limit ${String(MAX_LINE_CHARS)}): ${entry.rel}`);
  assert(problems.length <= 4, 'at most four problems per file');
  return problems;
}

/** Writes the plugin's LICENSE as a byte copy of the repository root's. */
export function syncLicense(root: string): void {
  assert(isAbsolute(root), `root must be absolute: ${root}`);
  const src = join(root, LICENSE_REL);
  assert(existsSync(src), `missing ${src}`);
  copyFileSync(src, assertUnderRoot(root, join(PLUGIN_DIR, LICENSE_REL)));
  assert(readFileSync(src).equals(readFileSync(join(root, PLUGIN_DIR, LICENSE_REL))), 'the LICENSE copy matches');
}

/** The plugin's LICENSE must equal the root LICENSE; the icon must be 100644 in git's index. */
export function checkLicenseAndIcon(root: string): string[] {
  assert(isAbsolute(root), `root must be absolute: ${root}`);
  const problems: string[] = [];
  const copy = join(root, PLUGIN_DIR, LICENSE_REL);
  if (!existsSync(copy) || !readFileSync(copy).equals(readFileSync(join(root, LICENSE_REL)))) {
    problems.push(`${PLUGIN_DIR}/${LICENSE_REL} must be a byte copy of the root LICENSE`);
  }
  // The index mode, not the filesystem's (exec bits on some mounts are synthetic).
  const ls = spawnSync('git', ['ls-files', '-s', '--', join(PLUGIN_DIR, ICON_REL)], { cwd: root, encoding: 'utf-8' });
  const mode = ls.status === 0 ? ls.stdout.trim().split(/\s+/)[0] : undefined;
  if (mode !== undefined && mode !== '' && mode !== '100644') problems.push(`${PLUGIN_DIR}/${ICON_REL} must be mode 100644 in git, not ${mode}`);
  assert(problems.length <= 2, 'at most two problems');
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
