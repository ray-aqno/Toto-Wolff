import { join, isAbsolute, sep, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert';
import type { IncomingMessage, ServerResponse } from 'node:http';

const MAX_CONTENT_BYTES = 100_000;

const TYPE_TO_DIR: Record<string, string> = {
  council: join('Council', 'Congressional-Records'),
  p10: 'P10-Plans',
};

/** Returns true only if resolved path is strictly inside vaultPath (not a sibling prefix). */
function isInsideVault(resolved: string, vaultPath: string): boolean {
  return resolved === vaultPath || resolved.startsWith(vaultPath + sep);
}

/**
 * Resolves a vault-relative filename to an absolute path.
 * Returns null if type is invalid or filename is empty/contains path separators.
 */
function resolveRecordPath(
  vaultPath: string,
  type: string,
  filename: string,
): string | null {
  assert(isAbsolute(vaultPath), 'resolveRecordPath: vaultPath must be absolute');
  const subDir = TYPE_TO_DIR[type];
  if (subDir === undefined) return null;
  if (filename.length === 0 || filename.includes('..') || filename.includes('/') || filename.includes(sep)) {
    return null;
  }
  const resolved = resolve(join(vaultPath, subDir, filename));
  if (!isInsideVault(resolved, vaultPath)) return null;
  assert(resolved.startsWith(vaultPath), 'resolveRecordPath: post-check — resolved must be inside vault');
  return resolved;
}

/**
 * Reads a vault record file and streams it to the response.
 * ENOENT → 404. Content > MAX_CONTENT_BYTES → 413. Other errors → 500.
 */
async function sendRecord(res: ServerResponse, filePath: string): Promise<void> {
  assert(isAbsolute(filePath), 'sendRecord: filePath must be absolute');
  assert(!res.destroyed, 'sendRecord: response already destroyed');

  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (err) {
    if (res.destroyed) return;
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Record not found.');
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain' }).end('Internal error.');
    }
    return;
  }

  if (content.length > MAX_CONTENT_BYTES) {
    if (!res.destroyed) {
      res.writeHead(413, { 'Content-Type': 'text/plain' }).end('Record too large.');
    }
    return;
  }

  if (!res.destroyed) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(content);
  }
}

/**
 * Handles GET /dashboard/record?type=council|p10&file=<filename>.
 * Validates params, resolves path, and streams file content.
 * 400 for missing/invalid params. 404 for traversal attempts or missing files.
 */
export async function handleRecordRequest(
  req: IncomingMessage,
  res: ServerResponse,
  vaultPath: string,
): Promise<void> {
  assert(isAbsolute(vaultPath), 'handleRecordRequest: vaultPath must be absolute');
  assert(!res.destroyed, 'handleRecordRequest: response already destroyed on entry');

  const rawUrl = req.url ?? '';
  const qIdx = rawUrl.indexOf('?');
  const qs = qIdx >= 0 ? new URLSearchParams(rawUrl.slice(qIdx + 1)) : new URLSearchParams();

  const type = qs.get('type') ?? '';
  const file = qs.get('file') ?? '';

  if (!type || !file) {
    if (!res.destroyed) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: 'missing required params: type, file' }));
    }
    return;
  }

  const filePath = resolveRecordPath(vaultPath, type, file);
  if (filePath === null) {
    if (!res.destroyed) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found.');
    }
    return;
  }

  await sendRecord(res, filePath);
}
