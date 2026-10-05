// Built-in vault search for the file backend: a literal, case-sensitive
// substring match over every file below the vault root, with no external
// program. Three caps bound the work and the reply; any cap that fires sets
// `truncated`. Paths are absolute: the root string joined with the entry
// names, never resolved, so they always start with the root the caller gave.
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { SearchResult } from '../types.mts';

export const MAX_SEARCH_RESULTS = 500;
export const MAX_SEARCH_FILE_BYTES = 1024 * 1024;
export const MAX_SEARCH_TOTAL_BYTES = 512 * 1024;
/** Deepest directory level the search descends to (P10 Rule 2). */
const MAX_SEARCH_DEPTH = 16;

export interface BoundedSearch {
  results: SearchResult[];
  truncated: boolean;
}

interface SearchState extends BoundedSearch {
  totalBytes: number;
  done: boolean;
}

// Adds one result if it fits the result and byte budgets; otherwise marks the
// search truncated and done. The budget is checked before adding, so no reply
// ever exceeds MAX_SEARCH_TOTAL_BYTES, even for one very long line.
function addResult(state: SearchState, result: SearchResult): void {
  assert.ok(!state.done, 'no result is added after the search stops');
  const bytes = Buffer.byteLength(JSON.stringify(result), 'utf8') + 1;
  if (state.results.length >= MAX_SEARCH_RESULTS || state.totalBytes + bytes > MAX_SEARCH_TOTAL_BYTES) {
    state.truncated = true;
    state.done = true;
    return;
  }
  state.results.push(result);
  state.totalBytes += bytes;
  assert.ok(state.totalBytes <= MAX_SEARCH_TOTAL_BYTES, 'the byte budget holds');
}

// Searches one file. Oversized files are skipped and mark the search
// truncated; unreadable files are skipped silently.
async function searchFile(state: SearchState, file: string, query: string): Promise<void> {
  assert.ok(query.length > 0, 'the query is never empty');
  let content: string;
  try {
    if ((await stat(file)).size > MAX_SEARCH_FILE_BYTES) {
      state.truncated = true;
      return;
    }
    content = await readFile(file, 'utf8');
  } catch {
    return;
  }
  if (!content.includes(query)) return;
  const lines = content.split('\n');
  // LOOP BOUND: lines in one file of at most MAX_SEARCH_FILE_BYTES bytes.
  for (let i = 0; i < lines.length && !state.done; i++) {
    const line = lines[i];
    if (line !== undefined && line.includes(query)) addResult(state, { file, line: i + 1, text: line.trim() });
  }
}

// Reads one directory's entries sorted by name, or none if it is unreadable.
async function sortedEntries(dir: string): Promise<{ name: string; isFile: boolean; isDirectory: boolean }[]> {
  assert.ok(dir.length > 0, 'a directory path is never empty');
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const named = entries.map((e) => ({ name: e.name, isFile: e.isFile(), isDirectory: e.isDirectory() }));
    return named.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch {
    return [];
  }
}

/**
 * Searches every file below `rootPath` for `query`. Entries whose own name
 * starts with "." are skipped (so .git and .obsidian are never read; the root
 * itself may sit inside a dot-directory). Symbolic links are not followed.
 */
export async function searchFiles(rootPath: string, query: string): Promise<BoundedSearch> {
  assert.ok(rootPath.length > 0, 'the vault root is never empty');
  assert.ok(query.length > 0, 'the query is never empty');
  const state: SearchState = { results: [], truncated: false, totalBytes: 0, done: false };
  const stack: { dir: string; depth: number }[] = [{ dir: rootPath, depth: 0 }];
  // LOOP BOUND: one pass per directory in the vault, at most MAX_SEARCH_DEPTH levels deep.
  while (stack.length > 0 && !state.done) {
    const current = stack.pop();
    assert.ok(current !== undefined, 'walk stack underflow');
    const subdirs: string[] = [];
    // LOOP BOUND: the entries of one directory.
    for (const entry of await sortedEntries(current.dir)) {
      if (state.done) break;
      if (entry.name.startsWith('.')) continue;
      const full = join(current.dir, entry.name);
      if (entry.isDirectory) {
        // Too deep to search: say so, since a match there would be missing.
        if (current.depth < MAX_SEARCH_DEPTH) subdirs.push(full);
        else state.truncated = true;
      } else if (entry.isFile) await searchFile(state, full, query);
    }
    // Pushed in reverse so subdirectories are searched in name order.
    for (let i = subdirs.length - 1; i >= 0; i--) {
      const dir = subdirs[i];
      assert.ok(dir !== undefined, 'subdirectory index in range');
      stack.push({ dir, depth: current.depth + 1 });
    }
  }
  return { results: state.results, truncated: state.truncated };
}
