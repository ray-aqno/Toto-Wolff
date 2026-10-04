// MCP 2026-07-28, the stateless era: each request carries its protocol version
// and client capabilities in params._meta, and every result carries a
// resultType. There is no initialize, no ping and no batch. Requests without
// these _meta keys are served by the legacy (2025-11-25) path instead.
import assert from 'node:assert/strict';
import {
  INTERNAL_ERROR,
  INVALID_PARAMS,
  META_CLIENT_CAPABILITIES,
  META_PROTOCOL_VERSION,
  META_SERVER_INFO,
  MODERN_VERSIONS,
  RpcError,
  UNSUPPORTED_PROTOCOL_VERSION,
  isRecord,
  truncateUtf8,
} from './protocol.mts';
import type { Message } from './protocol.mts';

// How long a client may reuse tools/list and server/discover results. The tool
// set is fixed for the life of the process.
export const TOOLS_TTL_MS = 300_000;
export const CACHE_SCOPE = 'public';
const MAX_ECHOED_VERSION_BYTES = 128;

export type ServerInfo = Readonly<{ name: string; version: string }>;

// True when params._meta holds either required 2026-07-28 key (own keys only,
// whatever their values). Every other request takes the legacy path.
export function isModern(params: unknown): boolean {
  if (!isRecord(params) || !isRecord(params._meta)) return false;
  const meta = params._meta;
  assert.ok(isRecord(meta), 'meta narrowed to an object');
  return Object.hasOwn(meta, META_PROTOCOL_VERSION) || Object.hasOwn(meta, META_CLIENT_CAPABILITIES);
}

// Validates a modern request's _meta: field presence and type first (-32602),
// then the version (-32022). Only called for requests isModern accepted.
export function checkMeta(params: unknown): void {
  assert.ok(isModern(params), 'checkMeta runs only on modern requests');
  const meta = isRecord(params) && isRecord(params._meta) ? params._meta : {};
  const version = meta[META_PROTOCOL_VERSION];
  if (typeof version !== 'string') {
    throw new RpcError(INVALID_PARAMS, `_meta["${META_PROTOCOL_VERSION}"] must be a string`);
  }
  if (!isRecord(meta[META_CLIENT_CAPABILITIES])) {
    throw new RpcError(INVALID_PARAMS, `_meta["${META_CLIENT_CAPABILITIES}"] must be an object`);
  }
  if (!MODERN_VERSIONS.includes(version)) {
    const requested = version.length > 0 ? truncateUtf8(version, MAX_ECHOED_VERSION_BYTES) : version;
    throw new RpcError(UNSUPPORTED_PROTOCOL_VERSION, 'Unsupported protocol version', {
      supported: [...MODERN_VERSIONS],
      requested,
    });
  }
}

// Returns a new result with resultType ("complete" unless the handler set one)
// and the server's identity merged into _meta. Never writes to `result`.
export function withComplete(result: Message, serverInfo: ServerInfo): Message {
  assert.ok(serverInfo.name.length > 0, 'the server has a name');
  const meta = result._meta;
  if (meta !== undefined && !isRecord(meta)) throw new RpcError(INTERNAL_ERROR, 'Internal error');
  const resultType = typeof result.resultType === 'string' ? result.resultType : 'complete';
  const wrapped: Message = { ...result, resultType, _meta: { ...(isRecord(meta) ? meta : {}), [META_SERVER_INFO]: { ...serverInfo } } };
  assert.equal(typeof wrapped.resultType, 'string', 'every modern result has a resultType');
  return wrapped;
}

// server/discover: built fresh for every reply, so no reply can alter another.
export function discoverResult(serverInfo: ServerInfo): Message {
  assert.ok(MODERN_VERSIONS.length > 0, 'at least one modern version is served');
  const result = withComplete(
    { supportedVersions: [...MODERN_VERSIONS], capabilities: { tools: {} }, ttlMs: TOOLS_TTL_MS, cacheScope: CACHE_SCOPE },
    serverInfo,
  );
  assert.equal(result.resultType, 'complete', 'discover always completes');
  return result;
}

// tools/list: the whole list in one page. The server never issues a cursor, so
// any cursor a client sends is invalid (-32602), including "" and null.
export function toolsListResult(definitions: readonly unknown[], params: unknown, serverInfo: ServerInfo): Message {
  assert.ok(Number.isInteger(definitions.length), 'definitions are a list');
  if (isRecord(params) && Object.hasOwn(params, 'cursor')) throw new RpcError(INVALID_PARAMS, 'Invalid cursor');
  const result = withComplete({ tools: [...definitions], ttlMs: TOOLS_TTL_MS, cacheScope: CACHE_SCOPE }, serverInfo);
  assert.ok(Number.isInteger(result.ttlMs) && Number(result.ttlMs) >= 0, 'ttlMs is a non-negative integer');
  return result;
}
