# Contributing to toto-wolff

toto-wolff is a TypeScript monorepo that adds persistent AI governance to Claude Code workflows. This document is the complete guide for making changes.

If you are new to the project, read the [Concepts section in README.md](README.md#concepts) first. Terms like P10, council, Cabinet, Congressional Record, and signal store are used throughout this document and are defined there.

---

## Getting started

**Prerequisites:** Node 24, pnpm 11.5.1, bash ≥ 3.2, git.

Check versions:
```bash
node --version    # v24.x.x
pnpm --version    # 11.5.1
```

Install pnpm if needed:
```bash
npm install -g pnpm@11.5.1
```

Clone and install (substitute your actual repo URL):
```bash
git clone https://github.com/ray-aqno/Toto-Wolff toto-wolff
cd toto-wolff
pnpm install
```

Build all packages:
```bash
pnpm -r build
```

Run all tests:
```bash
pnpm -r test
```

Type-check without emitting:
```bash
pnpm -r exec tsc --noEmit
```

Run a single package:
```bash
pnpm -C packages/mcp-server build
pnpm -C packages/mcp-server test
```

Start the MCP server locally:
```bash
node packages/mcp-server/dist/index.js
# Server binds to 127.0.0.1:3099
```

Drive the full governance cycle end-to-end:
```bash
./scripts/demo.sh
```

---

## Repository structure

```
toto-wolff/
├── packages/
│   ├── core/          # Shared types, error classes, VaultService, CouncilService, P10Service
│   ├── mcp-server/    # HTTP MCP server — 6 tools, 8 HTTP endpoints
│   ├── cli/           # toto binary — init, doctor, whoami, search, last, audit, dashboard, backfill, radio
│   ├── dashboard/     # Server-rendered HTML dashboard (no React; dashboard_html.ts generates static HTML)
│   └── personas/      # Persona stubs — engineering, devops, r-and-d, data
├── scripts/           # Shell scripts — setup, bootstrap-env, demo, install-symlink
├── tests/             # bats test suites for shell scripts
├── docs/              # Design docs and ADRs
└── CLAUDE.md          # Live symlink target — Toto Wolff persona definition
```

**What goes in each package:**

| Package | Add here when... |
|---------|-----------------|
| `core` | A type, error class, or service is needed by more than one other package |
| `mcp-server` | Adding an HTTP endpoint or an MCP tool handler |
| `cli` | Adding a `toto <command>` subcommand |
| `dashboard` | Changing the dashboard HTML or SSE behavior |
| `personas` | Adding or editing a persona file |

**Import rule (invariant):** No package imports from a sibling package directly. All shared code goes through `@toto-wolff/core`. If `mcp-server` needs something from `cli`, that thing belongs in `core` first.

Violating this rule creates circular dependency risk and breaks the build order that `pnpm -r build` relies on.

---

## Development workflow

Every non-trivial change follows this sequence:

### 1. Write a P10 plan

Before touching any file, run `/p10 <task description>` in a Claude Code session. Opus must set `status: approved` before implementation starts.

An approved plan looks like this in the Congressional Record:
```
status: approved
stages: 3
stage_1: Add VaultService.search() method — assertions: input is non-empty string, output is SignalRecord[]
stage_2: Wire search to toto search CLI command
stage_3: Add tests for both happy path and empty-results case
```

A blocked plan looks like this:
```
status: blocked
blocker: Proposed vault schema change conflicts with existing P10 plan #2026-06-20. Resolve schema ownership before proceeding.
resolution: Escalate to /council with both plan references.
```

If Opus returns `status: blocked`, surface the blockers in a `/council` session before retrying.

For changes that are clearly mechanical (fix a typo, bump a version number, add a missing import), a P10 plan is not required.

### 2. Implement

Follow the approved P10 stages in order. Every changed line traces to a stage in the plan.

### 3. Verify

Run tests and type-check:
```bash
pnpm -r test
pnpm -r exec tsc --noEmit
```

Run the security invariant checks (see [Security](#security)):
```bash
grep -r "bind\|listen" packages/mcp-server/src | grep -v "127.0.0.1"
# Should return nothing
```

For shell script changes, run the bats suite:
```bash
cd tests && bats setup.bats
cd tests && bats bootstrap-env.bats
```

### 4. Open a PR

Complete the [Pull request checklist](#pull-request-checklist) before requesting review.

---

## Code standards

### P10 rules as code discipline

These four P10 rules apply to every file in this repo:

**Rule 2 — No magic numbers.** All numeric limits are named constants. Examples: `MAX_RECORDS = 500` in `signal_index.ts`, `MAX_RECORD_BYTES = 10240` in `signal_index.ts`, `MAX_PLAN_FILES = 500` in the reversed-verdict handler. If you need a numeric boundary, declare a `const` with an ALL_CAPS name and a comment explaining its purpose.

**Rule 5 — Assertions on all assumptions.** Use `assert` from `node:assert/strict` for invariants that must hold at runtime. Examples: schema checks on MCP tool inputs, vault path validation before any file write, API credential presence before any Anthropic call. Never silently proceed when an assumption fails.

**Rule 4 — Short functions.** Functions should fit on a screen without scrolling (target: ≤ 60 lines). If a function is longer, it is doing more than one thing. Extract the second thing.

**Rule 10 — Zero warnings.** `tsc --noEmit` must exit 0 with no diagnostics. `pnpm -r exec tsc --noEmit` is a required gate before every PR. No `// @ts-ignore` or `any` casts without an explicit comment naming why the type system cannot express the constraint.

### Zero production npm dependencies

`packages/mcp-server` and `packages/cli` have no production npm dependencies beyond `@toto-wolff/core` (a local workspace package). Node built-ins only: `node:fs`, `node:path`, `node:http`, `node:assert`, `node:crypto`. If you find yourself reaching for an npm package for production code, stop. Use the built-in or write the 10-line utility.

Dev dependencies (vitest, typescript, esbuild) are fine.

### Docstring policy

jCodeMunch builds symbol summaries from docstrings. Without them, summaries fall back to the function signature, which is less useful for search and navigation.

- Write a JSDoc docstring for every exported function, method, and class.
- Write one for private functions when the name and signature are not self-explanatory (`_reconcileState` yes, `_add(a, b)` no).
- Docstrings say WHAT the function does and WHY, not the parameter types (TypeScript already states those).
- When modifying a function that lacks a docstring, add one.

Example:
```typescript
/**
 * Scores a set of signal records against a candidate plan's topics and pattern.
 * Returns HIGH if ≥2 distinct in-date records match and Jaccard similarity ≥ 0.5;
 * returns LOW with disqualifiers otherwise. Deterministic — no LLM call.
 */
export function scoreConfidence(records: SignalRecord[], plan: PlanCandidate): ConfidenceResult {
```

---

## Adding a command

Step-by-step for adding `toto <mycommand>`:

**1. Create the command file.**

```
packages/cli/src/commands/mycommand.ts
```

Export a single async function `runMyCommand(args: string[]): Promise<void>`. Add a JSDoc docstring.

**2. Add a test file.**

```
packages/cli/src/commands/mycommand.test.ts
```

At minimum: one test for the happy path, one for the error path (missing args or bad input).

**3. Wire it to the CLI entry point.**

Open `packages/cli/src/index.ts`. The entry point has a command dispatch map. Add your command:

```typescript
import { runMyCommand } from './commands/mycommand.js';

// In the dispatch map:
case 'mycommand': {
  await runMyCommand(args.slice(1));
  break;
}
```

**4. Update the help text.**

The `help` command in `packages/cli/src/commands/help.ts` lists available commands. Add a one-line entry for yours.

**5. Build and test.**

```bash
pnpm -C packages/cli build
pnpm -C packages/cli test
```

**6. Manual smoke test.**

```bash
node packages/cli/dist/index.js mycommand
```

---

## Adding an MCP tool

Step-by-step for adding a new tool to the MCP server:

**1. Create the handler file.**

```
packages/mcp-server/src/handlers/my_tool.ts
```

Export two things:
- `MY_TOOL_SCHEMA`: a JSON Schema object describing the tool's input parameters. The ALL_CAPS convention signals that this is a module-level constant — a schema definition, not a live value.
- `handleMyTool(params: unknown): Promise<ToolResult>`: the handler. Validate `params` with `assert` before using any field.

**2. Create a test file.**

```
packages/mcp-server/src/handlers/my_tool.test.ts
```

Cover: happy path, invalid params (assert fires), and any error branch the handler has.

**3. Register the tool in the TOOLS map.**

Open `packages/mcp-server/src/index.ts`. Add your tool to the `TOOLS` registry:

```typescript
import { MY_TOOL_SCHEMA, handleMyTool } from './handlers/my_tool.js';

// In the TOOLS map:
my_tool: {
  description: 'One sentence. What it does.',
  inputSchema: MY_TOOL_SCHEMA,
  handler: handleMyTool,
},
```

**4. If the tool needs a new HTTP endpoint**, add a route handler in `packages/mcp-server/src/index.ts` before the `TOOLS` lookup block. Follow the same pattern as `handleSseRequest` or `handleRecordRequest`: validate inputs, guard against path traversal, never expose raw error internals in the response body.

**5. Build and test.**

```bash
pnpm -C packages/mcp-server build
pnpm -C packages/mcp-server test
```

**6. Update CLAUDE.md HTTP API docs** if you added an HTTP endpoint. The docs section is under `## MCP Server (optional, v2 default)`.

---

## Tests

**TypeScript tests** live alongside the source file they test:

```
packages/core/src/VaultService.ts
packages/core/src/VaultService.test.ts
```

Run with vitest:
```bash
pnpm -r test                      # all packages
pnpm -C packages/core test        # one package
pnpm -C packages/core test --watch  # watch mode
```

**Shell script tests** live in `tests/` and run with [bats](https://github.com/bats-core/bats-core):

```bash
bats tests/setup.bats
bats tests/bootstrap-env.bats
```

**Coverage expectations:**

- New command files: happy path + error path required before merge.
- New MCP tool handlers: happy path + invalid params + every distinct error branch.
- New pure utility functions (like `scoreConfidence`): full branch coverage. These are deterministic and cheap to test.
- Shell script changes: add a bats test for each new code path in `setup` or `bootstrap-env.sh`.

The CI pipeline (`pnpm -r test`) must pass on every PR. The eval-gate job additionally requires `ANTHROPIC_API_KEY` in CI secrets and all 3 eval assertions to pass for merges to main. The 3 assertions are defined in `tests/eval/assertions.ts` — read that file if a failing eval gate needs debugging.

---

## Security

Five invariants must never regress. Check them before every PR.

**1. Loopback-only bind.**

The MCP server must bind `127.0.0.1`, never `0.0.0.0` or `::`. Verify:
```bash
grep -r "listen\b" packages/mcp-server/src/index.ts
# Must show 127.0.0.1 as the bind address
```

**2. `escHtml()` on all user-controlled strings in HTML output.**

Any string from the vault (file names, dates, record content) that appears in `dashboard_html.ts` HTML output must be wrapped in `escHtml()`. Raw vault content is untrusted; XSS via a crafted record file is a real attack path. Check `packages/mcp-server/src/dashboard_html.ts` after any HTML change.

**3. ISO date regex, not length check.**

Date validation must use the ISO regex `/^\d{4}-\d{2}-\d{2}$/`, not `str.length === 10`. The length check accepts US-format dates (`06/24/2026`) silently. See `scoreConfidence` in `packages/core/src/scoreConfidence.ts`. Any new date parsing must use the same regex.

**4. No raw error internals in HTTP responses.**

HTTP error responses must never include stack traces, vault file paths, or internal variable names. Log those to stderr; send a fixed string or a sanitized message to the caller. See `p10_plan` handler — `P10BlockedError` returns `{status: 'blocked'}`, nothing else.

**5. Gitleaks rule for manifest tokens.**

`.gitleaks.toml` includes a `manifest-auth-token` rule matching the `mnfst_` prefix. This rule must stay in `.gitleaks.toml`. Documentation must use non-secret placeholders such as `<your-manifest-token>` instead of token-shaped examples. If you add a new token format, add a matching gitleaks rule in the same PR.

---

## Pull request checklist

Complete this before requesting review. Copy it into your PR description.

```
- [ ] `pnpm -r exec tsc --noEmit` exits 0 with no diagnostics
- [ ] `pnpm -r test` passes; test count did not decrease
- [ ] Every new exported function has a JSDoc docstring
- [ ] No new production npm dependencies added (dev deps are fine)
- [ ] If a numeric boundary was added, it is a named constant with a comment
- [ ] No raw error internals exposed in any HTTP response path I touched
- [ ] `grep -r "listen\b" packages/mcp-server/src/index.ts` still shows 127.0.0.1
- [ ] If I changed dashboard_html.ts, every vault-sourced string is wrapped in escHtml()
```

---

## Governance

### What `/council` is for

`/council` is for decisions where the tradeoffs are non-obvious and the cost of being wrong is high: new package boundaries, changes to the vault schema, deprecating a tool or endpoint, any change that affects the security invariants above.

Run it in a Claude Code session:
```
/council this: <your decision question + constraints>
```

The session runs a 6-call chain — two Claude Haiku "scout" agents stress-test assumptions in parallel, two Claude Sonnet "analyst" agents do structured risk and implementation analysis, a Sonnet briefer compresses all four outputs, and Claude Opus reads only the brief and issues a ruling. The output is a **Congressional Record** written to `~/.toto/vault/Council/Congressional-Records/`. The record is permanent. Reference it in your P10 plan and PR.

### What `/p10` is for

`/p10` is the pre-execution safety contract, grounded in [NASA JPL's Power of 10 rules](https://en.wikipedia.org/wiki/The_Power_of_10:_Rules_for_Developing_Safety-Critical_Code) for safety-critical software. It produces a staged plan with explicit assertions, loop bounds, and return-value checks for every stage. Opus must set `status: approved` before any file is touched. A `status: blocked` result means the implementation cannot proceed — escalate back to `/council`.

```
/p10 <task description + which package + optional council ruling reference>
```

### What `/cabinet` is for

`/cabinet` is the release gate. Three independent Opus agents, each shaped by a distinct persona, review the release evidence and must vote unanimously to ship. Any seat can issue a BLOCK — naming a specific release-critical defect — which holds the release until resolved. Run it at tagged releases, not on every commit.

The three seats:
- **Garry Tan** — product truth. Catches scope creep, version dishonesty, and ships that don't serve a real user.
- **Richard Feynman** — first-principles correctness. Catches claims that are asserted but not demonstrated, and correctness theater.
- **Andrej Karpathy** — engineering execution. Catches debt dressed as a release, missing test coverage, and 3am failure modes.

### The Senate — stacking council and cabinet

For high-stakes decisions — major version tags, reversals of prior council rulings, or anything where a failure in product judgment, correctness, or engineering execution would be genuinely costly — run both in sequence:

1. `/council` to deliberate and reach a ruling on the architectural or product question
2. `/cabinet` to ratify the release against that ruling

This full stack is called "the Senate" internally. For routine work, either skill alone is sufficient. Use the Senate when the cost of being wrong in any single dimension (product, correctness, engineering) is high enough that you want independent verification across all three.

### When a council ruling is required

A change requires a `/council` session before a P10 plan when it involves:

- Adding or removing a package from the monorepo
- Changing the vault directory layout or file schema
- Adding a new HTTP endpoint or MCP tool that exposes vault data
- Modifying any of the 5 security invariants
- Changing the confidence scoring logic in `scoreConfidence.ts`
- Any dependency on a new external service or npm package (production)

For everything else, a P10 plan without a council ruling is sufficient. When in doubt, run council — it costs 5 minutes and produces a permanent record.
