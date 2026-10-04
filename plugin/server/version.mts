// Node version gate. Node below 22.18 cannot load a TypeScript entry at all,
// so this check only ever runs on 22.18 and newer.
import assert from 'node:assert/strict';

export const MIN_NODE_MAJOR = 24;
export const NODE_VERSION_MESSAGE = `toto-wolff needs Node ${String(MIN_NODE_MAJOR)}+`;

// Takes process.versions.node (for example "24.18.0", no leading "v").
export function checkNodeVersion(version: string): boolean {
  assert.equal(typeof version, 'string', 'a version is a string');
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  assert.ok(Number.isNaN(major) || Number.isInteger(major), 'a parsed major is an integer or NaN');
  return !Number.isNaN(major) && major >= MIN_NODE_MAJOR;
}
