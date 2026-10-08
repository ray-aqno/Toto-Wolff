---
name: graph-run
description: Drive a toto-wolff task graph run step by step (the built-in idea-to-pr graph, or a project graph in .toto/graphs) with the graph_* MCP tools. Asks the user at every human gate and choice. Use for "run idea-to-pr on <idea>", "start a graph run", "resume run <runId>", or "/graph-run".
version: 1.0.0
---

# graph-run

Drives a run of a toto-wolff task graph. The server keeps the state and decides the next step; you do each step, report it, and ask the user at every gate. The tools are the toto-wolff MCP server's `graph_*` tools (in Claude Code: `mcp__plugin_toto-wolff_toto-wolff__graph_*`).

## Start or resume

- **New run:** `graph_list` to see the graphs (`idea-to-pr` is built in). Then `graph_start({ graph, input: { idea }, stopAt? })`. `idea`'s first line is its title: it names the RFC or ADR file.
- **Existing run:** `graph_resume({ runId })` returns the step in flight. A run stopped at its target (`stopped_at_target`) continues with `graph_resume` (optionally with a new `stopAt`).

## The loop

Repeat until the reply has no `step` (status `done`, `failed` or `stopped_at_target`):

1. Read the reply's `step` (or call `graph_next({ runId })`): `nodeId`, `kind`, `skill`, `instruction`, and for a loop `iteration`.
2. Do the step, by its kind:
   - **skill or loop:** run the named skill. A name resolves with or without the `toto-wolff:` prefix (for example `p10-bridge` or `toto-wolff:p10-bridge`). If that skill is not available, do the step's `instruction` directly and start the evidence with `did directly: <reason>`.
   - **a document step (the step has `doc`):** get the template with `graph_template({ kind })`, create the folder if needed, and write the document at exactly `doc.path`, only if no file exists there yet. Never overwrite a file. If the step shows `doc.error`, stop and tell the user (for example, `DOC_EXISTS`: move the existing document first).
   - **choice:** ask the user (see Asking the user), with your recommendation, and report their pick as `choice`.
   - **human_gate:** see Human gates. Never report a gate with `graph_report`.
3. Report with `graph_report({ runId, nodeId, outcome, evidence, artifacts?, choice?, iteration? })`:
   - `outcome` is `pass` or `fail`; `evidence` says what was done and what showed it worked.
   - for a loop, always pass the step's `iteration`, so a retried report never uses up an attempt;
   - for a document step, `artifacts[0]` is `doc.path`;
   - for the `pr` step, `evidence` is the pull request URL alone.
4. If a report returns `{ error }`, read the message: `BAD_EVIDENCE` names what is wrong (fix it and report again); `STALE_STEP` means another step is current (call `graph_next`); `RUN_BUSY` means another session is changing the run (wait, then retry).

## Asking the user

Every choice and every human gate is asked with AskUserQuestion. If you cannot ask the user (AskUserQuestion is unavailable, fails, or returns an empty or default answer), stop and report that the run is awaiting a person: never call graph_approve, and never report a choice, without the user's own answer. This applies in headless runs, `-p` mode, auto mode and subagents.

## Human gates

At a `human_gate` step:

1. Ask the user with AskUserQuestion: the gate's `instruction`, a short summary of what was done since the previous gate, and every `did directly` evidence from those steps, quoted.
2. Only after the user answers, call `graph_approve({ runId, nodeId, decision, note })`: `decision` is `approve` or `reject` as the user said, and `note` is the user's answer, verbatim.

Never call graph_approve without asking first. In Claude Code's default permission mode the call also shows a permission prompt; do not suggest allowing `graph_approve` (or `mcp__plugin_toto-wolff_toto-wolff__*`), because that turns the gates into steps you could pass on your own.

## When the run ends

When the status is `done`, `failed` or `stopped_at_target`, write a summary record to the vault with `vault_write({ path: "Runs/YYYY-MM-DD-<runId>.md", content })`:

- frontmatter: `date`, `runId`, `graph`, `status`, the project directory (absolute);
- the idea; each gate with its decision and note; the RFC or ADR (absolute path) and the P10 plan (vault path); the PR URL if any. Gate decisions and notes, and every step's evidence, are in the run's event log, `<project>/.toto/runs/<runId>/events.jsonl` (one JSON object per line); read it with the Read tool, so a run resumed in a new session still has its earlier gates;
- for a failed run, the failing step and its evidence.

Then tell the user the status, where the record is, and the next step (for a stopped run: `graph_resume({ runId })`).
