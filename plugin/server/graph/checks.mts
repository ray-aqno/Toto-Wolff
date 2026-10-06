// Evidence checks for the built-in idea-to-pr graph (#63), run by the tool
// layer when a checked skill node reports `pass`. The server never writes the
// documents; it computes where the next one goes and checks what was written.
// Every failure is a GraphError (BAD_EVIDENCE or DOC_EXISTS) naming the
// reason; no path is ever built from a caller's string (the slug is a-z0-9-).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isRecord } from '../mcp/protocol.mts';
import { GraphError } from './model.mts';
import type { NodeCheck } from './model.mts';
import { templateHeadings } from './templates.mts';
import type { TemplateKind } from './templates.mts';

export const MAX_DOC_BYTES = 256 * 1024;
const MAX_DOC_ENTRIES = 1000;
const MAX_DOC_NUMBER = 9998;
const MAX_SLUG = 50;
const DOC_NAME = /^(\d{4})-(.+)\.md$/i;
// Owner and repo in GitHub's own characters, so `?` or `#` cannot fake a path (PR #71 review).
const PR_URL = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[0-9]+$/;

function bad(message: string): GraphError {
  return new GraphError('BAD_EVIDENCE', message);
}

function codeOf(err: unknown): string {
  return isRecord(err) && typeof err.code === 'string' ? err.code : err instanceof Error ? err.name : 'error';
}

/** The document kind a check verifies, or null for a non-document check. */
export function docKindOf(check: NodeCheck | undefined): TemplateKind | null {
  return check === 'rfc-doc' ? 'rfc' : check === 'adr-doc' ? 'adr' : null;
}

/**
 * The idea's slug: its first line lowercased, runs of non a-z0-9 turned into
 * "-", trimmed, cut to 50 and trimmed again; an empty result becomes
 * `idea-<6 hex>` from a hash, so different non-ASCII ideas differ (S5).
 */
export function ideaSlug(idea: string): string {
  const first = idea.split('\n')[0] ?? '';
  const slug = first.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, MAX_SLUG).replace(/-+$/, '');
  const result = slug.length > 0 ? slug : `idea-${createHash('sha1').update(first.trim() || idea).digest('hex').slice(0, 6)}`;
  assert.ok(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(result) && result.length <= MAX_SLUG + 11, 'a slug is a-z0-9 words joined by "-"');
  return result;
}

// One folder level of docs/<kind>: missing means empty (S2); a symlink or a
// non-directory is refused (condition 4).
async function realDir(path: string, label: string): Promise<boolean> {
  let st;
  try {
    st = await lstat(path);
  } catch (err) {
    if (codeOf(err) === 'ENOENT') return false;
    throw bad(`cannot read ${label} (${codeOf(err)})`);
  }
  if (st.isSymbolicLink()) throw bad(`${label} is a symbolic link; symlinked docs folders are not supported`);
  if (!st.isDirectory()) throw bad(`${label} is not a folder`);
  return true;
}

interface DocScan {
  highest: number;
  sameSlug: string | null;
}

// Numbers and same-slug files in docs/<kind>, case-insensitively (S3),
// ignoring `exclude` (the document being checked).
async function scanDocs(projectDir: string, kind: TemplateKind, slug: string, exclude: string | null): Promise<DocScan> {
  const scan: DocScan = { highest: 0, sameSlug: null };
  if (!(await realDir(join(projectDir, 'docs'), 'docs/')) || !(await realDir(join(projectDir, 'docs', kind), `docs/${kind}/`))) return scan;
  let names: string[];
  try {
    names = await readdir(join(projectDir, 'docs', kind));
  } catch (err) {
    throw bad(`cannot list docs/${kind}/ (${codeOf(err)})`);
  }
  if (names.length > MAX_DOC_ENTRIES) throw bad(`docs/${kind}/ has ${String(names.length)} entries; the limit is ${String(MAX_DOC_ENTRIES)}`);
  // LOOP BOUND: at most MAX_DOC_ENTRIES names (checked above).
  for (const name of names) {
    const m = DOC_NAME.exec(name);
    if (m === null || (exclude !== null && name.toLowerCase() === exclude.toLowerCase())) continue;
    scan.highest = Math.max(scan.highest, Number(m[1]));
    if ((m[2] ?? '').toLowerCase() === slug) scan.sameSlug = name;
  }
  assert.ok(scan.highest >= 0 && scan.highest <= 9999, 'a four-digit number');
  return scan;
}

/** The path (relative to the project) the next document for this idea goes to. */
export async function nextDocPath(projectDir: string, kind: TemplateKind, slug: string, exclude: string | null = null): Promise<string> {
  const scan = await scanDocs(projectDir, kind, slug, exclude);
  if (scan.sameSlug !== null) throw new GraphError('DOC_EXISTS', `docs/${kind}/${scan.sameSlug} already covers this idea; move it to write a new one`);
  if (scan.highest >= MAX_DOC_NUMBER) throw bad(`docs/${kind}/ already uses number ${String(scan.highest)}; the limit is ${String(MAX_DOC_NUMBER + 1)}`);
  const path = `docs/${kind}/${String(scan.highest + 1).padStart(4, '0')}-${slug}.md`;
  assert.ok(DOC_NAME.test(path.slice(`docs/${kind}/`.length)), 'the path is a numbered document');
  return path;
}

// Reads a regular, non-symlinked file through one handle, capped (condition 4).
// It must have been modified since the run started (`sinceMs`): an older
// document for the idea is not this run's work (PR #71 review).
async function readDoc(abs: string, shown: string, sinceMs: number): Promise<string> {
  let st;
  try {
    st = await lstat(abs);
  } catch (err) {
    throw bad(`${shown} cannot be read (${codeOf(err)})`);
  }
  if (st.isSymbolicLink() || !st.isFile()) throw bad(`${shown} must be a regular file, not a link or folder`);
  if (st.mtimeMs < sinceMs) throw new GraphError('DOC_EXISTS', `${shown} was written before this run started; move it and write this run's document`);
  const handle = await open(abs, 'r').catch((err: unknown) => {
    throw bad(`${shown} cannot be opened (${codeOf(err)})`);
  });
  try {
    const { size } = await handle.stat();
    if (size > MAX_DOC_BYTES) throw bad(`${shown} is ${String(size)} bytes; the limit is ${String(MAX_DOC_BYTES)}`);
    const buf = Buffer.alloc(size);
    await handle.read(buf, 0, size, 0);
    return buf.toString('utf8');
  } finally {
    await handle.close();
  }
}

// Backslashes to "/", and a leading project-dir prefix stripped (S4).
function normalise(projectDir: string, artifact: string): string {
  const posix = artifact.replace(/\\/g, '/');
  const root = `${projectDir.replace(/\\/g, '/').replace(/\/+$/, '')}/`;
  return posix.startsWith(root) ? posix.slice(root.length) : posix.replace(/^\.\//, '');
}

/** Checks a reported RFC/ADR: right path and number, a regular file, every template heading. */
export async function checkDoc(projectDir: string, kind: TemplateKind, idea: string, artifact: string | undefined, sinceMs: number): Promise<void> {
  const slug = ideaSlug(idea);
  const reported = artifact === undefined ? null : normalise(projectDir, artifact);
  const name = reported !== null && reported.startsWith(`docs/${kind}/`) ? reported.slice(`docs/${kind}/`.length) : null;
  const expected = await nextDocPath(projectDir, kind, slug, name);
  if (reported !== expected) throw bad(`artifacts[0] must be ${expected}${reported === null ? '' : `, not ${reported.slice(0, 200)}`}`);
  const text = await readDoc(join(projectDir, ...expected.split('/')), expected, sinceMs);
  const lines = new Set(text.split('\n').map((l) => l.trimEnd()));
  const missing = templateHeadings(kind).filter((h) => !lines.has(h));
  if (missing.length > 0) throw bad(`${expected} is missing the template headings: ${missing.join(', ')}`);
  assert.ok(lines.size > 0, 'the document has lines');
}

/** Checks the pr step's evidence: the pull request URL alone. */
export function checkPrUrl(evidence: string): void {
  const url = evidence.trim();
  if (!PR_URL.test(url)) throw bad('evidence must be the pull request URL alone, like https://github.com/<owner>/<repo>/pull/<number>');
  assert.ok(url.startsWith('https://github.com/'), 'a GitHub URL');
}
