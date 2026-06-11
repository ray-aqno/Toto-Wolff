import type Anthropic from '@anthropic-ai/sdk';
import assert from 'node:assert';
import { withLLMTimeout } from './utils/timeout.js';
import { createAnthropicClient } from './utils/anthropic.js';
import type { VaultService } from './VaultService.js';
import type { CouncilResult, CouncilRuling, CouncilStatus } from './types.js';

const VALID_STATUSES = new Set<CouncilStatus>(['approved', 'revision-required', 'blocked']);

export class CouncilService {
  private readonly client: Anthropic;
  private readonly vault: VaultService;

  constructor(vault: VaultService) {
    this.client = createAnthropicClient();
    this.vault = vault;
  }

  async runSession(question: string): Promise<CouncilResult> {
    assert(typeof question === 'string' && question.length > 0, 'question must be non-empty');
    assert(question.length <= 4000, 'question must not exceed 4000 chars');

    const scouts = await this.runScouts(question);
    const analysts = await this.runAnalysts(question, scouts);
    const brief = await this.compressBrief([...scouts, ...analysts]);
    const ruling = await this.runChairman(brief);
    const planPath = `Council/Congressional-Records/${Date.now()}-council.md`;
    await this.vault.write(planPath, formatRecord(question, ruling));
    await this.vault.drainQueue();
    return { status: 'ok', ruling, planPath };
  }

  private async runScouts(question: string): Promise<string[]> {
    const outputs = await Promise.all([
      withLLMTimeout((opts) => this.callModel('claude-haiku-4-5-20251001', `Scout 1: ${question}`, opts), 'scout-1'),
      withLLMTimeout((opts) => this.callModel('claude-haiku-4-5-20251001', `Scout 2: ${question}`, opts), 'scout-2'),
    ]);
    assert(Array.isArray(outputs) && outputs.length === 2, 'scouts must return 2 outputs');
    assert(outputs.every((o): o is string => typeof o === 'string'), 'scout outputs must be strings');
    return outputs;
  }

  private async runAnalysts(question: string, scouts: string[]): Promise<string[]> {
    const context = scouts.join('\n\n');
    return Promise.all([
      withLLMTimeout((opts) => this.callModel('claude-sonnet-4-6', `Analyst 1 — scouts:\n${context}\n\nQuestion: ${question}`, opts), 'analyst-1'),
      withLLMTimeout((opts) => this.callModel('claude-sonnet-4-6', `Analyst 2 — scouts:\n${context}\n\nQuestion: ${question}`, opts), 'analyst-2'),
    ]);
  }

  private async compressBrief(outputs: string[]): Promise<string> {
    assert(outputs.length >= 2, 'brief requires at least 2 inputs');
    const brief = await withLLMTimeout(
      (opts) => this.callModel('claude-sonnet-4-6', `Compress into chairman brief:\n\n${outputs.join('\n\n')}`, opts),
      'compress-brief',
    );
    assert(brief.length > 0, 'brief must not be empty');
    return brief;
  }

  private async runChairman(brief: string): Promise<CouncilRuling> {
    assert(brief.length > 0, 'brief must not be empty');
    const raw = await withLLMTimeout(
      (opts) => this.callModel('claude-opus-4-8', brief, opts),
      'chairman',
    );
    const ruling = parseRuling(raw);
    assert(VALID_STATUSES.has(ruling.status), `ruling.status must be one of: ${[...VALID_STATUSES].join(', ')}`);
    return ruling;
  }

  private async callModel(model: string, prompt: string, opts: { signal: AbortSignal }): Promise<string> {
    const msg = await this.client.messages.create(
      { model, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] },
      { signal: opts.signal },
    );
    const block = msg.content[0];
    return block?.type === 'text' ? block.text : '';
  }
}

function parseRuling(raw: string): CouncilRuling {
  const match = raw.match(/status:\s*(approved|revision-required|blocked)/i);
  const status = (match?.[1]?.toLowerCase() ?? 'blocked') as CouncilStatus;
  return { status, summary: raw.slice(0, 500) };
}

function formatRecord(question: string, ruling: CouncilRuling): string {
  return `# Council Record\n\n**Question:** ${question}\n\n**Status:** ${ruling.status}\n\n**Summary:** ${ruling.summary}\n`;
}
