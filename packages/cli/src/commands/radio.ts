import * as readline from "node:readline";
import * as http from "node:http";
import * as https from "node:https";
import { createAnthropicClient } from "@toto-wolff/core";

// ─── ANSI palette (Mercedes Silver Arrows) ────────────────────────────────
const TEAL    = "\x1b[36m";   // #00D2BE approximation
const SILVER  = "\x1b[37m";
const BOLD    = "\x1b[1m";
const DIM     = "\x1b[2m";
const RESET   = "\x1b[0m";
const CLEAR   = "\x1b[2K\r";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

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

type AnthropicClient = ReturnType<typeof createAnthropicClient>;
type ChatMessage = { role: "user" | "assistant"; content: string };
type RadioBackend =
  | { type: "anthropic"; client: AnthropicClient; model: string }
  | { type: "ollama"; host: string; model: string };

const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_OLLAMA_MODEL    = "llama3.2";
const DEFAULT_OLLAMA_HOST     = "http://localhost:11434";

/**
 * Resolves which backend to use for radio.
 * Priority: explicit TOTO_RADIO_PROVIDER → Anthropic creds auto-detect → Ollama fallback.
 * Returns null only if provider is forced to anthropic but creds are missing.
 */
function resolveBackend(): RadioBackend | null {
  const provider = process.env["TOTO_RADIO_PROVIDER"];
  const model    = process.env["TOTO_RADIO_MODEL"];
  const ollamaHost = process.env["OLLAMA_HOST"] ?? DEFAULT_OLLAMA_HOST;

  if (provider === "ollama") {
    return { type: "ollama", host: ollamaHost, model: model ?? DEFAULT_OLLAMA_MODEL };
  }

  // Try Anthropic (explicit or auto-detect)
  try {
    const client = createAnthropicClient();
    return { type: "anthropic", client, model: model ?? DEFAULT_ANTHROPIC_MODEL };
  } catch {
    if (provider === "anthropic") return null;
    // No creds — fall back to Ollama
    return { type: "ollama", host: ollamaHost, model: model ?? DEFAULT_OLLAMA_MODEL };
  }
}

/** Spin the cursor while waiting for the backend. Returns a stop function. */
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
 * Streams a reply via Ollama's /api/chat NDJSON endpoint.
 * Uses node:http/https — no new runtime dependencies.
 */
async function streamReplyOllama(
  host: string,
  model: string,
  messages: ChatMessage[],
): Promise<string> {
  const stop = startSpinner("Pit wall thinking...");

  const body = JSON.stringify({
    model,
    stream: true,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages,
    ],
  });

  const url = new URL("/api/chat", host);
  const lib = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        if (res.statusCode === 404) {
          stop();
          reject(new Error(`Ollama model '${model}' not found — run: ollama pull ${model}`));
          res.resume();
          return;
        }
        if (res.statusCode !== 200) {
          stop();
          reject(new Error(`Ollama returned HTTP ${res.statusCode ?? "unknown"}`));
          res.resume();
          return;
        }

        stop();
        process.stdout.write(`\n${TEAL}${BOLD}TOTO${RESET} `);

        let full = "";
        let buf  = "";

        res.on("data", (chunk: Buffer) => {
          buf += chunk.toString();
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line) as {
                message?: { content?: string };
                done?: boolean;
              };
              const token = parsed.message?.content ?? "";
              if (token) {
                process.stdout.write(token);
                full += token;
              }
            } catch { /* skip malformed line */ }
          }
        });

        res.on("end", () => {
          process.stdout.write("\n\n");
          resolve(full);
        });
      },
    );

    req.on("error", (err: NodeJS.ErrnoException) => {
      stop();
      if (err.code === "ECONNREFUSED") {
        reject(new Error(`Ollama not running at ${host} — start with: ollama serve`));
      } else {
        reject(err);
      }
    });

    req.write(body);
    req.end();
  });
}

/**
 * Streams a single turn to stdout with teal prefix, returns full text.
 * Dispatches to Anthropic streaming or Ollama NDJSON based on the resolved backend.
 */
async function streamReply(
  backend: RadioBackend,
  messages: ChatMessage[],
): Promise<string> {
  if (backend.type === "ollama") {
    return streamReplyOllama(backend.host, backend.model, messages);
  }

  const stop = startSpinner("Pit wall thinking...");
  let full = "";

  const stream = await backend.client.messages.stream({
    model: backend.model,
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
      process.stdout.write(chunk.delta.text);
      full += chunk.delta.text;
    }
  }

  process.stdout.write("\n\n");
  return full;
}

/**
 * Entry point for `toto radio`.
 * Opens an interactive readline loop with the Toto Wolff persona.
 * Resolves backend (Anthropic or Ollama) at startup. Shows which backend is active.
 * Maintains conversation history for multi-turn context.
 * Exits cleanly on Ctrl+C with a team radio sign-off.
 */
export async function runRadio(): Promise<void> {
  const backend = resolveBackend();

  if (!backend) {
    process.stderr.write(
      `toto radio: no API credentials found.\n` +
      `Export ANTHROPIC_AUTH_TOKEN, ANTHROPIC_API_KEY, or set TOTO_RADIO_PROVIDER=ollama.\n`,
    );
    process.exit(1);
  }

  const backendLabel =
    backend.type === "anthropic"
      ? `${TEAL}Anthropic${RESET} · ${DIM}${backend.model}${RESET}`
      : `${TEAL}Ollama${RESET} · ${DIM}${backend.model} @ ${backend.host}${RESET}`;

  const BANNER = `
${TEAL}${BOLD}╔══════════════════════════════════════════╗
║  🎙  TOTO RADIO — PIT WALL · BRACKLEY    ║
╚══════════════════════════════════════════╝${RESET}
${DIM}Mercedes-AMG Petronas Formula One Team${RESET}
${DIM}Backend:${RESET} ${backendLabel}
${DIM}Ask a governance question. Ctrl+C to box.${RESET}

`;

  process.stdout.write(BANNER);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const history: ChatMessage[] = [];

  const prompt = (): void => {
    rl.question(`${SILVER}You${RESET}  `, async (input) => {
      const trimmed = input.trim();
      if (trimmed.length === 0) {
        prompt();
        return;
      }

      history.push({ role: "user", content: trimmed });

      try {
        const reply = await streamReply(backend, history);
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
