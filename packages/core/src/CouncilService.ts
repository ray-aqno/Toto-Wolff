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
const FASTPATH_MODEL = 'claude-sonnet-4-6';

// T10: no-tradeoff-language heuristic — presence of any term below routes to full chain.
const TRADEOFF_KEYWORDS = ['vs', 'should we', 'tradeoff', 'trade-off', 'risk'];
const FASTPATH_PERSONA = 'You are answering a quick factual lookup against a governance vault search result. Summarize what the match says in 2-3 sentences. No preamble, no deliberation, no hedging.';

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
   * Run a council session on a governance question.
   * T10 fast-path: factual questions (no tradeoff language) with a direct vault_search hit
   * skip straight to a single Sonnet summary call instead of the full 6-call chain.
   * Full chain flow: parallel scouts → compression → parallel analysts → brief → chairman ruling → vault write.
   */
  async run(question: string, currentTags: string[] = [], priors: SignalRecord[] = []): Promise<CouncilResult> {
    assert(typeof question === 'string' && question.length > 0, 'question must be non-empty');
    assert(question.length <= 4000, 'question must not exceed 4000 chars');

    if (this._isFactualQuestion(question)) {
      const fastResult = await this._tryFastPath(question);
      if (fastResult !== null) return fastResult;
    }

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
   * T10 heuristic: a question is "factual" (fast-path eligible) when it contains
   * no tradeoff/deliberation language. Deliberative questions always take the full chain.
   */
  private _isFactualQuestion(question: string): boolean {
    const lower = question.toLowerCase();
    return !TRADEOFF_KEYWORDS.some((kw) => lower.includes(kw));
  }

  /**
   * T10 fast-path: vault_search + single Sonnet call for direct factual lookups.
   * Returns null (caller falls back to full chain) if vault_search finds nothing.
   */
  private async _tryFastPath(question: string): Promise<CouncilResult | null> {
    const hits = await this.vault.search(question);
    if (hits.length === 0) return null;

    const topHits = hits.slice(0, 5); // P10 Rule 2: bounded
    const matchContext = topHits.map((h) => `${h.file}:${h.line}: ${h.text}`).join('\n');
    const summary = await withLLMTimeout(
      (opts) => this._callModel(FASTPATH_MODEL, FASTPATH_PERSONA, `Vault matches:\n${matchContext}\n\nQuestion: ${question}`, opts),
      'fastpath-summary',
    );
    assert(summary.length > 0, 'fastpath summary must not be empty');

    const recordPath = `Council/Congressional-Records/${Date.now()}-council-fastpath.md`;
    await this.vault.write(recordPath, formatRecord(question, summary, { status: 'approved', summary }));
    await this.vault.drainQueue();

    return {
      status: 'approved',
      ruling: summary,
      brief: summary,
      recordPath,
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
