import type Anthropic from '@anthropic-ai/sdk';
import assert from 'node:assert';
import { withLLMTimeout } from './utils/timeout.js';
import { createAnthropicClient } from './utils/anthropic.js';
import type { VaultService } from './VaultService.js';
import type { CouncilRuling, CouncilStatus, SignalRecord } from './types.js';
import { detectReversal } from './utils/reversalDetector.js';

export interface CouncilResult {
  status: CouncilStatus;
  ruling: string;
  brief: string;
  recordPath: string;
  /**
   * Invariant: `priorId` is only ever set when `reversalDetected === true`.
   * Callers must check `reversalDetected` first — do not branch on the
   * truthiness of `priorId` alone, since its absence does not by itself
   * mean no reversal was detected (both fields are optional).
   */
  reversalDetected?: boolean;
  priorId?: string;
}

const SCOUT_MODEL = 'claude-haiku-4-5-20251001';
const ANALYST_MODEL = 'claude-sonnet-4-6';
const BRIEF_MODEL = 'claude-sonnet-4-6';
const CHAIRMAN_MODEL = 'claude-opus-4-8';

const SCOUT_1_PERSONA = 'You are a pragmatic senior engineer on an F1 engineering council. Identify concrete technical risks, implementation obstacles, and resource constraints. Be specific — name files, services, real numbers. No hedging.';
const SCOUT_2_PERSONA = 'You are a systems architect on an F1 engineering council. Identify structural concerns, long-term maintainability risks, and irreversible architectural decisions. Name the breaking points precisely.';
const ANALYST_1_PERSONA = 'You are a product-oriented senior engineer on an F1 engineering council. Synthesize scout findings through user impact and production readiness. Give a concrete recommendation. One call, no hedging.';
const ANALYST_2_PERSONA = 'You are a contrarian reviewer on an F1 engineering council. Steelman the weakest option. Surface what the other analysts missed. You are the last check before a bad decision ships.';
const BRIEF_WRITER_PERSONA = 'Synthesize these analyst perspectives into a compact 200-word chairman brief. Lead with the core tension, surface the 3 key risks, state the recommended path. No preamble.';
const CHAIRMAN_PERSONA = 'You are the chairman of an F1 engineering council — final decision authority. Rule on this decision: approved, revision-required, or blocked. Name the risk, name the tradeoff, make the call. No preamble. End your ruling with exactly one of: Status: approved | Status: revision-required | Status: blocked';

const VALID_STATUSES = new Set<CouncilStatus>(['approved', 'revision-required', 'blocked']);

export class CouncilService {
  private readonly client: Anthropic;
  private readonly vault: VaultService;

  constructor(vault: VaultService) {
    this.client = createAnthropicClient();
    this.vault = vault;
  }

  /**
   * Run a full council session on a governance question.
   * Flow: parallel scouts → compression → parallel analysts → brief → chairman ruling → vault write.
   */
  async run(question: string, currentTags: string[] = [], priors: SignalRecord[] = []): Promise<CouncilResult> {
    assert(typeof question === 'string' && question.length > 0, 'question must be non-empty');
    assert(question.length <= 4000, 'question must not exceed 4000 chars');

    // Scouts: clean slate — question only, no accumulated context (primacy bias mitigation)
    const [rawScout1, rawScout2] = await Promise.all([
      withLLMTimeout((opts) => this._callModel(SCOUT_MODEL, SCOUT_1_PERSONA, question, opts), 'scout-1'),
      withLLMTimeout((opts) => this._callModel(SCOUT_MODEL, SCOUT_2_PERSONA, question, opts), 'scout-2'),
    ]);

    // Compress each scout output independently before passing to analysts (context rot mitigation)
    const [scout1, scout2] = await Promise.all([
      this._compress(rawScout1),
      this._compress(rawScout2),
    ]);

    // Analysts: compressed scout findings at TOP, original question at BOTTOM
    const scoutContext = `Scout findings:\n${scout1}\n\n${scout2}`;
    const [analyst1, analyst2] = await Promise.all([
      withLLMTimeout(
        (opts) => this._callModel(ANALYST_MODEL, ANALYST_1_PERSONA, `${scoutContext}\n\nQuestion: ${question}`, opts),
        'analyst-1',
      ),
      withLLMTimeout(
        (opts) => this._callModel(ANALYST_MODEL, ANALYST_2_PERSONA, `${scoutContext}\n\nQuestion: ${question}`, opts),
        'analyst-2',
      ),
    ]);

    // Brief writer: analyst outputs at TOP, original question at BOTTOM
    const analystContext = `Analyst findings:\n${analyst1}\n\n${analyst2}`;
    const brief = await withLLMTimeout(
      (opts) => this._callModel(BRIEF_MODEL, BRIEF_WRITER_PERSONA, `${analystContext}\n\nQuestion: ${question}`, opts),
      'brief-writer',
    );
    assert(brief.length > 0, 'brief must not be empty');

    // Chairman: brief at TOP, original question at BOTTOM
    const rawRuling = await withLLMTimeout(
      (opts) => this._callModel(CHAIRMAN_MODEL, CHAIRMAN_PERSONA, `${brief}\n\nQuestion: ${question}`, opts),
      'chairman',
    );
    const ruling = parseRuling(rawRuling);
    assert(VALID_STATUSES.has(ruling.status), `ruling.status must be one of: ${[...VALID_STATUSES].join(', ')}`);

    const recordPath = `Council/Congressional-Records/${Date.now()}-council.md`;
    await this.vault.write(recordPath, formatRecord(question, brief, ruling));
    await this.vault.drainQueue();

    // Ruling is already written to vault above — a bad detectReversal input must
    // degrade, not throw, or a successful council write would look like a failure.
    let reversal = null;
    try {
      reversal = detectReversal(ruling.status, currentTags, priors);
    } catch {
      reversal = null;
    }

    return {
      status: ruling.status,
      ruling: ruling.summary,
      brief,
      recordPath,
      reversalDetected: reversal !== null,
      ...(reversal !== null ? { priorId: reversal.priorId } : {}),
    };
  }

  /**
   * Compress verbose scout output to 5 terse bullet points.
   * Reduces context rot in downstream analyst calls (Hong et al.).
   */
  private async _compress(rawText: string): Promise<string> {
    assert(typeof rawText === 'string' && rawText.length > 0, 'rawText must be non-empty');
    return withLLMTimeout(
      (opts) => this._callModel(
        BRIEF_MODEL,
        'Extract the 5 most critical risk points as terse bullet points. One sentence each, concrete, no hedging.',
        rawText,
        opts,
      ),
      'compress',
    );
  }

  private async _callModel(
    model: string,
    system: string,
    userMessage: string,
    opts: { signal: AbortSignal },
  ): Promise<string> {
    const msg = await this.client.messages.create(
      {
        model,
        max_tokens: 1024,
        temperature: 0,
        system,
        messages: [{ role: 'user', content: userMessage }],
      },
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

function formatRecord(question: string, brief: string, ruling: CouncilRuling): string {
  return `# Council Record\n\n**Question:** ${question}\n\n**Brief:** ${brief}\n\n**Status:** ${ruling.status}\n\n**Ruling:** ${ruling.summary}\n`;
}
