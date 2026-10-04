import { describe, expect, it } from 'vitest';
import {
  INVALID_PARAMS,
  INVALID_REQUEST,
  PARSE_ERROR,
  RpcError,
  isId,
  isRecord,
  parseRequest,
  requireString,
  toolError,
  truncateUtf8,
} from '../../plugin/server/mcp/protocol.mts';

describe('parseRequest', () => {
  it('parses a request with an id', () => {
    const parsed = parseRequest('{"jsonrpc":"2.0","id":7,"method":"ping"}');
    expect(parsed).toEqual({ ok: true, request: { hasId: true, id: 7, method: 'ping', params: undefined } });
  });

  it('treats a missing id as a notification', () => {
    const parsed = parseRequest('{"jsonrpc":"2.0","method":"notifications/initialized"}');
    expect(parsed.ok && parsed.request.hasId).toBe(false);
  });

  it.each([
    ['not json', PARSE_ERROR],
    ['[{"jsonrpc":"2.0","id":1,"method":"ping"}]', INVALID_REQUEST],
    ['{"jsonrpc":"1.0","id":1,"method":"ping"}', INVALID_REQUEST],
    ['{"jsonrpc":"2.0","id":1}', INVALID_REQUEST],
    ['{"jsonrpc":"2.0","id":{},"method":"ping"}', INVALID_REQUEST],
    ['null', INVALID_REQUEST],
  ])('rejects %s with code %i', (line, code) => {
    const parsed = parseRequest(line);
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.error.code).toBe(code);
  });
});

describe('guards', () => {
  it('isRecord accepts only plain objects', () => {
    expect([isRecord({}), isRecord([]), isRecord(null), isRecord('x')]).toEqual([true, false, false, false]);
  });

  it('isId accepts strings, finite numbers and null', () => {
    expect([isId('a'), isId(0), isId(null), isId(Number.NaN), isId({})]).toEqual([true, true, true, false, false]);
  });
});

describe('truncateUtf8', () => {
  it('returns short text unchanged', () => {
    expect(truncateUtf8('hello', 5)).toBe('hello');
  });

  it('never splits a multibyte character', () => {
    const cut = truncateUtf8('aé€', 4);
    expect(cut).toBe('aé');
    expect(Buffer.byteLength(cut)).toBeLessThanOrEqual(4);
  });

  it('keeps a character that ends exactly at the limit', () => {
    expect(truncateUtf8('é€x', 5)).toBe('é€');
  });

  it('cuts plain ASCII at the limit', () => {
    expect(truncateUtf8('abcdef', 3)).toBe('abc');
  });
});

describe('tool helpers', () => {
  it('toolError marks the result as an error', () => {
    expect(toolError('boom')).toEqual({ content: [{ type: 'text', text: 'boom' }], isError: true });
  });

  it('requireString returns the value or rejects with INVALID_PARAMS', () => {
    expect(requireString({ q: 'x' }, 'q')).toBe('x');
    expect(() => requireString({ q: 1 }, 'q')).toThrow(RpcError);
    try {
      requireString({}, 'q');
    } catch (err) {
      expect(err instanceof RpcError && err.code).toBe(INVALID_PARAMS);
    }
  });
});
