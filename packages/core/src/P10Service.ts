import Anthropic from '@anthropic-ai/sdk';
import assert from 'node:assert';
import { withLLMTimeout } from './utils/timeout.js';
import { P10BlockedError } from './types.js';
import type { VaultService } from './VaultService.js';
import type { P10Result, P10Ruling, P10Status } from './types.js';

const VALID_STATUSES = new Set<P10Status>(['approved', 'revision-required', 'blocked']);
// LOOP BOUND: revision cycle capped at 1 (Opus ruling CB1)
const MAX_REVISIONS = 1;

export class P10Service {
  private readonly client: Anthropic;
  private readonly vault: VaultService;

  constructor(vault: VaultService) {
    // CSO: API key narrowed in Node, never logged or exposed in errors
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    assert(typeof apiKey === 'string' && apiKey.length > 0, 'ANTHROPIC_API_KEY must be set and non-empty');
    this.client = new Anthropic({ apiKey });
    this.vault = vault;
  }

  async runPlan(task: string): Promise<P10Result> {
    assert(typeof task === 'string' && task.length > 0, 'task must be non-empty');
    assert(task.length <= 4000, 'task must not exceed 4000 chars');

    const scouts = await this.runScouts(task);
    const analysis = await this.runAnalyzer(task, scouts);
    let draft = await this.runDraftWriter(analysis);
    let ruling = await this.runArbiter(draft);

    let revisionCount = 0;
    while (ruling.status === 'revision-required' && revisionCount < MAX_REVISIONS) {
      revisionCount++;
      draft = await withLLMTimeout(
        (opts) => this.callModel('claude-sonnet-4-6', `Revise per: ${ruling.requiredChanges ?? ''}\n\nDraft:\n${draft}`, opts),
        'draft-revision',
      );
      ruling = await this.runArbiter(draft);
    }

    const planPath = await this.commitPlan(ruling, draft);
    if (ruling.status === 'blocked') {
      throw new P10BlockedError(`P10 plan blocked. Plan saved to ${planPath}`);
    }
    return { status: ruling.status, planPath };
  }

  private async runScouts(task: string): Promise<string[]> {
    return Promise.all([
      withLLMTimeout((opts) => this.callModel('claude-haiku-4-5-20251001', `P10 Scout 1: ${task}`, opts), 'p10-scout-1'),
      withLLMTimeout((opts) => this.callModel('claude-haiku-4-5-20251001', `P10 Scout 2: ${task}`, opts), 'p10-scout-2'),
    ]);
  }

  private async runAnalyzer(task: string, scouts: string[]): Promise<string> {
    return withLLMTimeout(
      (opts) => this.callModel('claude-sonnet-4-6', `Analyze:\n${task}\n\nScouts:\n${scouts.join('\n')}`, opts),
      'p10-analyzer',
    );
  }

  private async runDraftWriter(analysis: string): Promise<string> {
    return withLLMTimeout(
      (opts) => this.callModel('claude-sonnet-4-6', `Write P10 plan from analysis:\n${analysis}`, opts),
      'p10-draft',
    );
  }

  private async runArbiter(draft: string): Promise<P10Ruling> {
    assert(draft.length > 0, 'draft must not be empty');
    const raw = await withLLMTimeout(
      (opts) => this.callModel('claude-opus-4-8', `Arbitrate P10 plan:\n${draft}`, opts),
      'p10-arbiter',
    );
    const ruling = parseP10Ruling(raw);
    assert(VALID_STATUSES.has(ruling.status), `ruling.status must be valid P10Status`);
    return ruling;
  }

  private async commitPlan(ruling: P10Ruling, draft: string): Promise<string> {
    assert(ruling.status === 'approved' || ruling.status === 'blocked', 'can only commit terminal status');
    const filename = `P10-Plans/${Date.now()}-p10-plan.md`;
    assert(filename.endsWith('.md'), 'plan filename must end in .md');
    await this.vault.write(filename, formatPlan(ruling, draft));
    await this.vault.drainQueue();
    return filename;
  }

  private async callModel(model: string, prompt: string, opts: { signal: AbortSignal }): Promise<string> {
    const msg = await this.client.messages.create(
      { model, max_tokens: 2048, messages: [{ role: 'user', content: prompt }] },
      { signal: opts.signal },
    );
    const block = msg.content[0];
    return block?.type === 'text' ? block.text : '';
  }
}

function parseP10Ruling(raw: string): P10Ruling {
  const match = raw.match(/status:\s*(approved|revision-required|blocked)/i);
  const status = (match?.[1]?.toLowerCase() ?? 'blocked') as P10Status;
  const changesMatch = raw.match(/required.changes?:\s*([^\n]+)/i);
  const ruling: P10Ruling = { status, summary: raw.slice(0, 500) };
  if (changesMatch?.[1] !== undefined) ruling.requiredChanges = changesMatch[1];
  return ruling;
}

function formatPlan(ruling: P10Ruling, draft: string): string {
  return `---\nstatus: ${ruling.status}\n---\n\n${draft}\n`;
}
