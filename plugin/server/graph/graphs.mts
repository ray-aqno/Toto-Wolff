// User graphs: <project>/.toto/graphs/*.json, validated on load. At most 64
// files are read (name order), each at most 64 KiB, checked by size before it
// is read. A graph is found by its parsed id, never by joining a caller's
// string into a path (Safety Car S8).
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { INTERNAL_ERROR, RpcError, isRecord } from '../mcp/protocol.mts';
import { GraphError } from './model.mts';
import type { Graph } from './model.mts';
import { parseGraph } from './validate.mts';

export const MAX_GRAPH_FILES = 64;
export const MAX_GRAPH_BYTES = 64 * 1024;

export interface InvalidGraph {
  file: string;
  error: string;
}

export interface UserGraphs {
  graphs: { graph: Graph; file: string }[];
  invalid: InvalidGraph[];
}

/** The project's user graph folder, `<project>/.toto/graphs`. */
export function graphsDir(projectDir: string): string {
  const dir = join(projectDir, '.toto', 'graphs');
  assert.ok(dir.startsWith(projectDir), 'graphs live inside the project');
  return dir;
}

// The folder's *.json file names in name order. A missing folder means no
// graphs; any other read failure is a readable error, not an empty list.
async function jsonFiles(dir: string): Promise<string[]> {
  assert.ok(dir.endsWith('graphs'), 'the graphs folder');
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (isRecord(err) && err.code === 'ENOENT') return [];
    const detail = isRecord(err) && typeof err.code === 'string' ? err.code : String(err);
    throw new RpcError(INTERNAL_ERROR, `toto-wolff: cannot read ${dir} (${detail})`);
  }
  return entries.filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => e.name).sort();
}

// Loads one file: a Graph, or the reason it is invalid.
async function loadOne(dir: string, file: string): Promise<Graph | string> {
  assert.ok(file.endsWith('.json') && !file.includes('/'), 'a file name in the graphs folder');
  const path = join(dir, file);
  let text: string;
  try {
    const size = (await stat(path)).size;
    if (size > MAX_GRAPH_BYTES) return `${String(size)} bytes, over the ${String(MAX_GRAPH_BYTES)}-byte limit`;
    text = await readFile(path, 'utf8');
  } catch (err) {
    return `unreadable (${err instanceof Error ? err.message : String(err)})`;
  }
  try {
    return parseGraph(JSON.parse(text) as unknown);
  } catch (err) {
    // Deeply nested JSON throws RangeError; any parse failure is reported (S10).
    return err instanceof GraphError ? err.message : `not valid JSON (${err instanceof Error ? err.name : 'error'})`;
  }
}

/** Every user graph, valid or not; the first file wins a duplicate id. */
export async function loadUserGraphs(projectDir: string): Promise<UserGraphs> {
  const dir = graphsDir(projectDir);
  const files = await jsonFiles(dir);
  const out: UserGraphs = { graphs: [], invalid: [] };
  // LOOP BOUND: at most MAX_GRAPH_FILES files.
  for (const file of files.slice(0, MAX_GRAPH_FILES)) {
    const loaded = await loadOne(dir, file);
    if (typeof loaded === 'string') out.invalid.push({ file, error: loaded });
    else if (out.graphs.some((g) => g.graph.id === loaded.id)) out.invalid.push({ file, error: `duplicate graph id ${loaded.id}` });
    else out.graphs.push({ graph: loaded, file });
  }
  if (files.length > MAX_GRAPH_FILES) {
    out.invalid.push({ file: '(more)', error: `${String(files.length - MAX_GRAPH_FILES)} files beyond the limit of ${String(MAX_GRAPH_FILES)} were not read` });
  }
  assert.ok(out.graphs.length + out.invalid.length <= MAX_GRAPH_FILES + 1, 'the listing is bounded');
  return out;
}

/** The user graph with this id, or UNKNOWN_GRAPH / INVALID_GRAPH. */
export async function findGraph(projectDir: string, id: string): Promise<Graph> {
  const { graphs, invalid } = await loadUserGraphs(projectDir);
  const found = graphs.find((g) => g.graph.id === id);
  if (found !== undefined) return found.graph;
  // An invalid file named after the id explains why it is not usable.
  const bad = invalid.find((g) => g.file === `${id}.json`);
  if (bad !== undefined) throw new GraphError('INVALID_GRAPH', `graph ${id} (${bad.file}): ${bad.error}`);
  assert.ok(graphs.every((g) => g.graph.id !== id), 'no valid graph has this id');
  throw new GraphError('UNKNOWN_GRAPH', `no graph ${id.slice(0, 40)} in ${graphsDir(projectDir)}`);
}
