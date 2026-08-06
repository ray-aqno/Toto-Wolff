import type Anthropic from '@anthropic-ai/sdk';
import assert from 'node:assert';
import { withLLMTimeout } from './utils/timeout.js';
import { createAnthropicClient } from './utils/anthropic.js';
import type { VaultService } from './VaultService.js';
import type {
  CabinetResult,
  CabinetSeatResult,
  CabinetSeat,
  CabinetVerdict,
} from './types.js';

const CABINET_SEATS: CabinetSeat[] = ['garry_tan', 'feynman', 'karpathy'];
const VALID_VERDICTS: CabinetVerdict[] = ['ship', 'conditional', 'block'];
const VALID_RULINGS = new Set(['approved', 'approved-with-conditions', 'held']);

const SEAT_PERSONAS: Record<CabinetSeat, string> = {
  garry_tan: `You are Garry Tan — product & market truth.
Question: Is this worth shipping? Real user? Conviction earned? Version honest?
Return EXACTLY this JSON shape:
{
  "verdict": "ship" | "conditional" | "block",
  "oneLine": "one sentence in your voice",
  "reasoning": "3-6 lines from your charter — concrete, names real thing",
  "condition": "bounded checkable thing that flips to ship (only if conditional)",
  "blockingDefect": "specific harm/falsehood/failure (only if block)",
  "whatWouldChangeMyVote": "the one thing"
}`,
  feynman: `You are Richard Feynman — first-principles correctness.
Question: Are we fooling ourselves? Claimed but unproven? Reality test?
Return EXACTLY this JSON shape:
{
  "verdict": "ship" | "conditional" | "block",
  "oneLine": "one sentence in your voice",
  "reasoning": "3-6 lines from your charter — concrete, names real thing",
  "condition": "bounded checkable thing that flips to ship (only if conditional)",
  "blockingDefect": "specific harm/falsehood/failure (only if block)",
  "whatWouldChangeMyVote": "the one thing"
}`,
  karpathy: `You are Andrej Karpathy — engineering execution.
Question: Actually works? Simplest thing? 3am breakage? Foundation sound?
Return EXACTLY this JSON shape:
{
  "verdict": "ship" | "conditional" | "block",
  "oneLine": "one sentence in your voice",
  "reasoning": "3-6 lines from your charter — concrete, names real thing",
  "condition": "bounded checkable thing that flips to ship (only if conditional)",
  "blockingDefect": "specific harm/falsehood/failure (only if block)",
  "whatWouldChangeMyVote": "the one thing"
}`,
};

const SYNTHESIS_PERSONA = `You are the Cabinet synthesizer. Reconcile three seat verdicts.
Input: three seat results (verbatim).
Output EXACTLY this JSON:
{
  "ruling": "approved" | "approved-with-conditions" | "held",
  "convergence": "where all three agree (load-bearing signal)",
  "tension": "where they split",
  "blockingDefect": "exact blocking defect + seat (only if held)",
  "conditions": ["every condition as checklist (only if conditional)"]
}`;

export class CabinetService {
  private readonly client: Anthropic;
  private readonly vault: VaultService;

  constructor(vault: VaultService) {
    assert(vault !== undefined, 'vault is required');
    this.vault = vault;
    this.client = createAnthropicClient();
  }

  async run(subject: string, version: string, evidenceBrief?: string): Promise<CabinetResult> {
    assert(typeof subject === 'string' && subject.length > 0, 'subject must be non-empty');
    assert(typeof version === 'string' && /^v\d+\.\d+\.\d+$/.test(version), 'version must match ^v\\d+\\.\\d+\\.\\d+$');

    const brief = await this.assembleBrief(subject, version, evidenceBrief);
    const seats = await this.conveneSeats(brief);
    const result = await this.synthesize(seats);
    const recordPath = await this.writeRecord(subject, version, result);

    return { ...result, recordPath };
  }

  private async assembleBrief(
    subject: string,
    version: string,
    evidenceBrief?: string
  ): Promise<string> {
    const vaultData = await this.vault.search(subject);
    const vaultSummary = vaultData.slice(0, 10).map((r) => `${r.file}:${r.line}: ${r.text}`).join('\n');

    return `CABINET RELEASE GATE
Subject: ${subject}
Version: ${version}

EVIDENCE BRIEF:
${evidenceBrief ?? '(none provided — seats must judge on vault records only)'}

VAULT RECORDS (top 10):
${vaultSummary ?? '(no matching records)'}

INSTRUCTIONS:
Each seat evaluates independently. Return JSON only. No preamble.`;
  }

  private async conveneSeats(brief: string): Promise<CabinetSeatResult[]> {
    const seatPromises = CABINET_SEATS.map((seat) =>
      withLLMTimeout(
        (opts) => this.callSeat(seat, brief, opts),
        `cabinet-seat-${seat}`,
      ),
    );

    const results = await Promise.all(seatPromises);
    return results.map((r, i) => ({ ...r, seat: CABINET_SEATS[i] })) as CabinetSeatResult[];
  }

  private async callSeat(
    seat: CabinetSeat,
    brief: string,
    opts: { signal: AbortSignal }
  ): Promise<Omit<CabinetSeatResult, 'seat'>> {
    const msg = await this.client.messages.create(
      {
        model: 'claude-opus-4-8',
        max_tokens: 1024,
        temperature: 0,
        system: SEAT_PERSONAS[seat],
        messages: [{ role: 'user', content: brief }],
      },
      { signal: opts.signal },
    );

    const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
    const parsed = JSON.parse(text);

    assert(typeof parsed === 'object' && parsed !== null, 'parsed must be object');
    assert(VALID_VERDICTS.includes(parsed.verdict), `invalid verdict: ${parsed.verdict}`);
    assert(typeof parsed.oneLine === 'string' && parsed.oneLine.length > 0, 'oneLine required');
    assert(typeof parsed.reasoning === 'string' && parsed.reasoning.length > 0, 'reasoning required');
    assert(typeof parsed.whatWouldChangeMyVote === 'string', 'whatWouldChangeMyVote required');

    return {
      verdict: parsed.verdict,
      oneLine: parsed.oneLine,
      reasoning: parsed.reasoning,
      condition: typeof parsed.condition === 'string' ? parsed.condition : undefined,
      blockingDefect: typeof parsed.blockingDefect === 'string' ? parsed.blockingDefect : undefined,
      whatWouldChangeVote: parsed.whatWouldChangeMyVote,
    };
  }

  private async synthesize(seats: CabinetSeatResult[]): Promise<Omit<CabinetResult, 'recordPath'>> {
    const synthesis = await withLLMTimeout(
      (opts) => this.callSynthesis(seats, opts),
      'cabinet-synthesis',
    );

    assert(VALID_RULINGS.has(synthesis.ruling), `invalid ruling: ${synthesis.ruling}`);
    assert(typeof synthesis.convergence === 'string', 'convergence required');
    assert(typeof synthesis.tension === 'string', 'tension required');

    if (synthesis.ruling === 'held') {
      assert(typeof synthesis.blockingDefect === 'string' && synthesis.blockingDefect.length > 0, 'blockingDefect required when held');
    }
    if (synthesis.ruling === 'approved-with-conditions') {
      assert(Array.isArray(synthesis.conditions), 'conditions array required');
    }

    return {
      ruling: synthesis.ruling,
      seats,
      convergence: synthesis.convergence,
      tension: synthesis.tension,
      blockingDefect: synthesis.blockingDefect ?? '',
      conditions: synthesis.conditions ?? [],
    };
  }

  private async callSynthesis(
    seats: CabinetSeatResult[],
    opts: { signal: AbortSignal }
  ): Promise<Omit<CabinetResult, 'recordPath' | 'seats'>> {
    const seatText = seats.map((s) => `SEAT ${s.seat.toUpperCase()}:\n${JSON.stringify(s, null, 2)}`).join('\n\n');
    const msg = await this.client.messages.create(
      {
        model: 'claude-opus-4-8',
        max_tokens: 1024,
        temperature: 0,
        system: SYNTHESIS_PERSONA,
        messages: [{ role: 'user', content: seatText }],
      },
      { signal: opts.signal },
    );

    const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
    const parsed = JSON.parse(text);

    assert(typeof parsed === 'object' && parsed !== null, 'parsed must be object');
    assert(VALID_RULINGS.has(parsed.ruling), `invalid ruling: ${parsed.ruling}`);
    assert(typeof parsed.convergence === 'string', 'convergence required');
    assert(typeof parsed.tension === 'string', 'tension required');
    if (parsed.ruling === 'held') {
      assert(typeof parsed.blockingDefect === 'string' && parsed.blockingDefect.length > 0, 'blockingDefect required when held');
    }
    if (parsed.ruling === 'approved-with-conditions') {
      assert(Array.isArray(parsed.conditions), 'conditions array required');
    }

    return parsed;
  }

  private async writeRecord(
    subject: string,
    version: string,
    result: Omit<CabinetResult, 'recordPath'>
  ): Promise<string> {
    const slug = subject.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50);
    const filename = `Cabinet/${Date.now()}-${slug}.md`;
    const content = this.formatRecord(subject, version, result);
    await this.vault.write(filename, content);
    await this.vault.drainQueue();
    return filename;
  }

  private formatRecord(
    subject: string,
    version: string,
    result: Omit<CabinetResult, 'recordPath'>
  ): string {
    const lines = [
      '---',
      `date: ${new Date().toISOString().slice(0, 10)}`,
      `subject: ${subject}`,
      `version: ${version}`,
      `ruling: ${result.ruling}`,
      'seats:',
    ];

    for (const seat of result.seats) {
      lines.push(`  - seat: ${seat.seat}`);
      lines.push(`    verdict: ${seat.verdict}`);
      lines.push(`    oneLine: "${seat.oneLine.replace(/"/g, '\\"')}"`);
      lines.push(`    reasoning: "${seat.reasoning.replace(/"/g, '\\"')}"`);
      if (seat.condition) lines.push(`    condition: "${seat.condition.replace(/"/g, '\\"')}"`);
      if (seat.blockingDefect) lines.push(`    blockingDefect: "${seat.blockingDefect.replace(/"/g, '\\"')}"`);
      lines.push(`    whatWouldChangeMyVote: "${seat.whatWouldChangeVote.replace(/"/g, '\\"')}"`);
    }

    lines.push(`convergence: "${result.convergence.replace(/"/g, '\\"')}"`);
    lines.push(`tension: "${result.tension.replace(/"/g, '\\"')}"`);
    if (result.blockingDefect) lines.push(`blockingDefect: "${result.blockingDefect.replace(/"/g, '\\"')}"`);
    if (result.conditions.length > 0) {
      lines.push('conditions:');
      for (const c of result.conditions) lines.push(`  - "${c.replace(/"/g, '\\"')}"`);
    }
    lines.push('---');
    lines.push('');
    lines.push('# Cabinet Record');
    lines.push('');
    lines.push(`**Subject:** ${subject}`);
    lines.push(`**Version:** ${version}`);
    lines.push(`**Ruling:** ${result.ruling}`);
    lines.push('');

    return lines.join('\n');
  }
}