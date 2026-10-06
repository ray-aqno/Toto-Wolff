// The environment for the git and search subprocesses: PATH (and SystemRoot
// on Windows) only, so no variable the user has set reaches them.
import assert from 'node:assert/strict';
import process from 'node:process';

export function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const path = process.env['PATH'];
  if (path !== undefined) env['PATH'] = path;
  const systemRoot = process.platform === 'win32' ? process.env['SystemRoot'] : undefined;
  if (systemRoot !== undefined) env['SystemRoot'] = systemRoot;
  assert.ok(Object.keys(env).length <= 2, 'PATH and SystemRoot at most');
  return env;
}

// Vault commits are made as toto-wolff, since the user's git config is not read.
export const GIT_IDENTITY = ['-c', 'user.name=toto-wolff', '-c', 'user.email=toto-wolff@localhost'] as const;
