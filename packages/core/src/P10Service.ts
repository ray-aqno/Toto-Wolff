import type Anthropic from '@anthropic-ai/sdk';
import assert from 'node:assert';
import { withLLMTimeout } from './utils/timeout.js';
import { createAnthropicClient } from './utils/anthropic.js';
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
    this.client = createAnthropicClient();
    this.vault = vault;
  }

  /**
   * Run a full P10 pre-execution planning cycle for the given task.
   * Scouts run in parallel, outputs are compressed, then passed through
   * analyzer → draft writer → arbiter. One revision cycle is permitted.
   * Throws P10BlockedError if the arbiter blocks or the revision cap is hit.
   */
  async runPlan(task: string): Promise<P10Result> {
    assert(typeof task === 'string' && task.length > 0, 'task must be non-empty');
    assert(task.length <= 4000, 'task must not exceed 4000 chars');

    const scouts = await this.runScouts(task);
    const compressed = await this.compressScouts(scouts);
    const analysis = await this.runAnalyzer(task, compressed);
    let draft = await this.runDraftWriter(task, analysis);
    let ruling = await this.runArbiter(task, draft);

    let revisionCount = 0;
    while (ruling.status === 'revision-required' && revisionCount < MAX_REVISIONS) {
      revisionCount++;
      draft = await withLLMTimeout(
        (opts) =>
          this.callModel(
            'claude-sonnet-4-6',
            P10_REVISE(draft, ruling.requiredChanges ?? ''),
            undefined,
            opts,
          ),
        'draft-revision',
      );
      ruling = await this.runArbiter(task, draft);
    }
    // Revision cap reached without terminal status — treat as blocked (CSO: no silent AssertionError)
    if (ruling.status === 'revision-required') {
      ruling = { status: 'blocked', summary: 'Blocked: revision cap reached without arbiter approval.' };
    }

    const planPath = await this.commitPlan(ruling, draft);
    if (ruling.status === 'blocked') {
      throw new P10BlockedError(`P10 plan blocked. Plan saved to ${planPath}`);
    }
    return { status: ruling.status, planPath };
  }

  /**
   * Run the two scouts in parallel. Each scout receives only the task description
   * as its user message (no prior context) — per lost-in-the-middle positioning.
   */
  private async runScouts(task: string): Promise<string[]> {
    return Promise.all([
      withLLMTimeout(
        (opts) =>
          this.callModel('claude-haiku-4-5-20251001', P10_SCOUT_SKEPTIC(task), undefined, opts),
        'p10-scout-skeptic',
      ),
      withLLMTimeout(
        (opts) =>
          this.callModel('claude-haiku-4-5-20251001', P10_SCOUT_MINIMALIST(task), undefined, opts),
        'p10-scout-minimalist',
      ),
    ]);
  }

  /**
   * Compress each scout output to 5 terse bullet points before passing to the
   * analyzer. Prevents context rot and format tax from verbose scout prose.
   */
  private async compressScouts(scouts: string[]): Promise<string[]> {
    return Promise.all(
      scouts.map((scout, i) =>
        withLLMTimeout(
          (opts) =>
            this.callModel(
              'claude-sonnet-4-6',
              scout,
              'Extract the 5 most important findings as terse bullet points. One sentence each.',
              opts,
            ),
          `p10-compress-scout-${i}`,
        ),
      ),
    );
  }

  /**
   * Run the analyzer with compressed scout summaries at the top and the task at
   * the bottom — critical context first to avoid lost-in-the-middle degradation.
   */
  private async runAnalyzer(task: string, compressedScouts: string[]): Promise<string> {
    return withLLMTimeout(
      (opts) =>
        this.callModel('claude-sonnet-4-6', P10_ANALYZER(task, compressedScouts), undefined, opts),
      'p10-analyzer',
    );
  }

  /**
   * Run the draft writer with analyzer output at the top and the task at the
   * bottom — preserves primacy of analysis context.
   */
  private async runDraftWriter(task: string, analysis: string): Promise<string> {
    return withLLMTimeout(
      (opts) =>
        this.callModel('claude-sonnet-4-6', P10_DRAFT_WRITER(task, analysis), undefined, opts),
      'p10-draft',
    );
  }

  /**
   * Run the Opus arbiter with the draft plan at the top and the task at the
   * bottom — arbiter sees the artifact first, task last for grounding.
   */
  private async runArbiter(task: string, draft: string): Promise<P10Ruling> {
    assert(draft.length > 0, 'draft must not be empty');
    const raw = await withLLMTimeout(
      (opts) =>
        this.callModel('claude-opus-4-8', P10_ARBITER(task, draft), undefined, opts),
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

  /**
   * Call a model with temperature: 0 for deterministic planning output.
   * system prompt is optional; when provided it is passed as the system field.
   */
  private async callModel(
    model: string,
    userMessage: string,
    system: string | undefined,
    opts: { signal: AbortSignal },
  ): Promise<string> {
    const msg = await this.client.messages.create(
      {
        model,
        max_tokens: 2048,
        temperature: 0,
        ...(system !== undefined ? { system } : {}),
        messages: [{ role: 'user', content: userMessage }],
      },
      { signal: opts.signal },
    );
    const block = msg.content[0];
    return block?.type === 'text' ? block.text : '';
  }
}

// Scout prompts: task description only as user message (no prior context injected here).
const P10_SCOUT_SKEPTIC = (task: string) => `\
You are the Skeptic scout in a NASA Power of 10 pre-execution analysis. Be concise (under 150 words).

TASK: ${task}

Find failure modes. Check for:
- Unbounded loops or recursion without a fixed upper bound
- Error paths that silently swallow failures (empty catch, ignored return values)
- External boundaries with no validation (user input, file paths, env vars)
- Functions likely to exceed 60 lines or have more than one responsibility
- Missing assertions on invariants that could corrupt state

Use available code navigation tools (get_symbols_overview, find_symbol) if accessible.
Return a bulleted list of specific concerns with file references where possible. If none, say "No P10 concerns detected."`;

const P10_SCOUT_MINIMALIST = (task: string) => `\
You are the Minimalist scout in a NASA Power of 10 pre-execution analysis. Be concise (under 150 words).

TASK: ${task}

Find scope creep and over-engineering. Check for:
- Features or abstractions not required by the task
- Code that could be 20 lines but will likely be written as 80
- New seams (interfaces, services, files) that could be avoided
- Dependencies that could be replaced by simpler stdlib alternatives
- Anything that adds indirection without adding safety

Return a bulleted list of scope risks. If the task is already minimal, say "Scope looks right."`;

// Analyzer: compressed scout summaries at top, task at bottom.
const P10_ANALYZER = (task: string, scouts: string[]) => `\
SCOUT FINDINGS:
${scouts.map((s, i) => `Scout ${i + 1}:\n${s}`).join('\n\n')}

---

You are the P10 Analyzer. Synthesize the scout findings above into a structured risk analysis (under 250 words).

TASK: ${task}

Produce:
1. Risk Summary — top 3 risks ranked by severity
2. P10 Rules at stake — which NASA Power of 10 rules apply (bounds, assertions, single exit, etc.)
3. Implementation constraints — what the execution agent must enforce
4. Success criteria — 3 verifiable assertions that must pass before declaring the stage done`;

// Draft writer: analyzer output at top, task at bottom.
const P10_DRAFT_WRITER = (task: string, analysis: string) => `\
${analysis}

---

You are the P10 Draft Writer. Produce a P10 execution plan from the analysis above.

TASK: ${task}

Format the plan as:
---
status: [leave blank — arbiter sets this]
---

# P10 Plan

## Stages
[Number each stage. Each stage: name, what to build, P10 constraints, verification assertion.]

## Invariants
[List 3-5 invariants that must hold across all stages.]

## Blocked Paths
[Any implementation approaches the analysis ruled out, and why.]

Keep under 400 words. Be specific — name files, functions, types where known.`;

const P10_REVISE = (draft: string, requiredChanges: string) => `\
You are the P10 Draft Writer revising a plan after arbiter feedback.

REQUIRED CHANGES:
${requiredChanges}

ORIGINAL DRAFT:
${draft}

Apply the required changes. Preserve the plan format exactly:
---
status: [leave blank — arbiter sets this]
---

# P10 Plan

## Stages
[Keep unchanged stages, revise only what the arbiter flagged]

## Invariants
[Update if needed]

## Blocked Paths
[Update if needed]

Keep under 400 words.`;

// Arbiter: draft plan at top, task at bottom.
const P10_ARBITER = (task: string, draft: string) => `\
${draft}

---

You are the Arbiter for a P10 pre-execution plan. Your job: approve, request revision, or block.

TASK: ${task}

Evaluate against NASA Power of 10 rules:
1. Every loop has a fixed bound
2. No dynamic allocation after initialization
3. Max 60 lines per function
4. Assertions on all non-trivial return values and inputs
5. Single point of exit per function (except at validated boundaries)
6. Data scope minimized — no globals, no shared mutable state without explicit justification
7. No shell interpolation — subprocess calls use argv arrays
8. Security boundaries validated at ingress, not deep in the call graph

Respond with EXACTLY this format:
status: approved | revision-required | blocked
summary: [one paragraph — what you approved or why you blocked]
required-changes: [if revision-required, list the specific changes needed]`;

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
