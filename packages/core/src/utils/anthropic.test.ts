import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import { createAnthropicClient } from './anthropic.js';

const originalEnv = { ...process.env };

describe('createAnthropicClient', () => {
  beforeEach(() => {
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_AUTH_TOKEN'];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('constructs with ANTHROPIC_API_KEY set', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test-123';
    const client = createAnthropicClient();
    expect(client).toBeDefined();
  });

  it('constructs with ANTHROPIC_AUTH_TOKEN set', () => {
    process.env['ANTHROPIC_AUTH_TOKEN'] = 'bearer-test-456';
    const client = createAnthropicClient();
    expect(client).toBeDefined();
  });

  it('constructs with both set (no error)', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test-123';
    process.env['ANTHROPIC_AUTH_TOKEN'] = 'bearer-test-456';
    const client = createAnthropicClient();
    expect(client).toBeDefined();
  });

  it('throws when neither credential is set', () => {
    assert.throws(
      () => createAnthropicClient(),
      /ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN must be set/,
    );
  });

  it('treats empty strings as not set', () => {
    process.env['ANTHROPIC_API_KEY'] = '';
    process.env['ANTHROPIC_AUTH_TOKEN'] = '';
    assert.throws(
      () => createAnthropicClient(),
      /ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN must be set/,
    );
  });
});
