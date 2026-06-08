import { LLMTimeoutError } from '../types.js';

// Do NOT import RequestOptions from @anthropic-ai/sdk/core — unused with this signature (Opus note)
const ANTHROPIC_CALL_TIMEOUT_MS = 120_000;

export async function withLLMTimeout<T>(
  callFn: (opts: { signal: AbortSignal }) => Promise<T>,
  label: string,
  ms: number = ANTHROPIC_CALL_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, ms);
  try {
    // LOOP BOUND: no loop — single await
    const result = await callFn({ signal: controller.signal });
    return result;
  } catch (err) {
    if (controller.signal.aborted) {
      throw new LLMTimeoutError(`LLM call timed out after ${ms}ms: ${label}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
