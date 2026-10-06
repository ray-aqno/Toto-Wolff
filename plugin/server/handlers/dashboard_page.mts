// The dashboard as a page file: <vault>/.toto-wolff/dashboard.html, written by
// dashboard_status and refreshed after each vault_write once it exists. The
// folder carries its own .gitignore ("*"), so a git vault never commits it,
// and its leading dot keeps it out of vault_search and the dashboard counts.
import assert from 'node:assert/strict';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import process from 'node:process';
import { renderDashboardHtml } from './dashboard_html.mts';
import { handleDashboardStatus } from './dashboard_status.mts';

const PAGE_DIR = '.toto-wolff';
const PAGE_FILE = 'dashboard.html';
let writes = 0;

function hasCode(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === code;
}

/** Creates <vault>/.toto-wolff with its own .gitignore ("*"); an existing one is kept. */
async function ensurePageDir(vaultPath: string): Promise<string> {
  const dir = join(vaultPath, PAGE_DIR);
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(join(dir, '.gitignore'), '*\n', { flag: 'wx' });
  } catch (err) {
    if (!hasCode(err, 'EEXIST')) throw err;
  }
  assert.ok(dir.startsWith(vaultPath), 'the page folder is inside the vault');
  return dir;
}

/** Renders the dashboard and writes it to the page file; returns the file's absolute path. */
export async function writeDashboardPage(vaultPath: string): Promise<string> {
  assert.ok(isAbsolute(vaultPath), 'the vault path is absolute');
  const dir = await ensurePageDir(vaultPath);
  const html = renderDashboardHtml(await handleDashboardStatus(vaultPath));
  const page = join(dir, PAGE_FILE);
  // Write then rename, so an open page never reloads a half-written file. The
  // temporary name is unique per process and write, so two overlapping writes
  // (or two sessions sharing a vault) never rename each other's file.
  writes += 1;
  const tmp = page + '.' + String(process.pid) + '.' + String(writes) + '.tmp';
  await writeFile(tmp, html, 'utf8');
  await rename(tmp, page);
  assert.ok(isAbsolute(page), 'the page path is absolute');
  return page;
}
