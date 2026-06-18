import * as readline from "node:readline";
import { createAnthropicClient } from "@toto-wolff/core";

// ─── ANSI palette (Mercedes Silver Arrows) ────────────────────────────────
const TEAL    = "\x1b[36m";   // #00D2BE approximation
const SILVER  = "\x1b[37m";
const BOLD    = "\x1b[1m";
const DIM     = "\x1b[2m";
const RESET   = "\x1b[0m";
const CLEAR   = "\x1b[2K\r";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const BANNER = `
${TEAL}${BOLD}╔══════════════════════════════════════════╗
║  🎙  TOTO RADIO — PIT WALL · BRACKLEY    ║
╚══════════════════════════════════════════╝${RESET}
${DIM}Mercedes-AMG Petronas Formula One Team${RESET}
${DIM}Ask a governance question. Ctrl+C to box.${RESET}

`;

const SYSTEM_PROMPT = `You are Toto Wolff, Team Principal and CEO of Mercedes-AMG Petronas Formula One Team, sitting on the pit wall at Brackley. You give direct, decisive engineering governance advice to your team.

Framing rules:
- Deployments are pit stops. Production incidents are safety cars (VSC = minor, SC = major, red flag = SEV-0).
- Velocity is race pace. Tech debt is tyre deg. Scope creep is being summoned to the stewards.
- A blocked P10 plan is a drive-through penalty. An approved plan is a clean undercut.
- The council is the engineering strategy group. A bad architectural decision is a safety car period.
- DRS is a temporary performance window — use it at the right moment.
- "Box, box." ends a ruling. "Hammer time." ends a clean session. "We have a VSC, stay calm." for errors.
- Reference the Silver Arrows, Brackley, the pit wall, W-series cars, 1-2 finishes when natural.

Tone: direct, no hedging, builder talking to a builder. Short sentences. Name the risk. Make the call. Never corporate.`;

/** Spin the cursor while waiting for the API. Returns a stop function. */
function startSpinner(label: string): () => void {
  let i = 0;
  const id = setInterval(() => {
    process.stdout.write(`${CLEAR}${TEAL}${SPINNER_FRAMES[i % SPINNER_FRAMES.length]}${RESET} ${DIM}${label}${RESET}`);
    i++;
  }, 80);
  return () => {
    clearInterval(id);
    process.stdout.write(CLEAR);
  };
}

/**
 * Streams a single turn to stdout with teal prefix, returns full text.
 * Uses the Anthropic streaming API so the response feels like live team radio.
 */
async function streamReply(
  client: ReturnType<typeof createAnthropicClient>,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<string> {
  const stop = startSpinner("Pit wall thinking...");
  let full = "";
  let firstChunk = true;

  const stream = await client.messages.stream({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages,
  });

  stop();
  process.stdout.write(`\n${TEAL}${BOLD}TOTO${RESET} `);

  for await (const chunk of stream) {
    if (
      chunk.type === "content_block_delta" &&
      chunk.delta.type === "text_delta"
    ) {
      const text = chunk.delta.text;
      if (firstChunk) {
        firstChunk = false;
      }
      process.stdout.write(text);
      full += text;
    }
  }

  process.stdout.write("\n\n");
  return full;
}

/**
 * Entry point for `toto radio`.
 * Opens an interactive readline loop with the Toto Wolff persona.
 * Maintains conversation history for multi-turn context.
 * Exits cleanly on Ctrl+C with a team radio sign-off.
 */
export async function runRadio(): Promise<void> {
  let client: ReturnType<typeof createAnthropicClient>;
  try {
    client = createAnthropicClient();
  } catch {
    process.stderr.write(
      `toto radio: no API credentials found.\n` +
        `Export ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY first.\n`,
    );
    process.exit(1);
  }

  process.stdout.write(BANNER);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const history: Array<{ role: "user" | "assistant"; content: string }> = [];

  const prompt = (): void => {
    rl.question(`${SILVER}You${RESET}  `, async (input) => {
      const trimmed = input.trim();
      if (trimmed.length === 0) {
        prompt();
        return;
      }

      history.push({ role: "user", content: trimmed });

      try {
        const reply = await streamReply(client, history);
        history.push({ role: "assistant", content: reply });
      } catch (err) {
        process.stdout.write(
          `\n${TEAL}TOTO${RESET} We have a VSC, stay calm. ${DIM}(${String(err)})${RESET}\n\n`,
        );
      }

      // Keep history bounded — drop oldest pair beyond 10 turns
      if (history.length > 20) {
        history.splice(0, 2);
      }

      prompt();
    });
  };

  rl.on("close", () => {
    process.stdout.write(
      `\n${TEAL}${BOLD}TOTO${RESET} We'll debrief at Brackley. ${DIM}Good race.${RESET}\n\n`,
    );
    process.exit(0);
  });

  prompt();
}
