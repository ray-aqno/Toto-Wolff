import { join } from "node:path";
import assert from "node:assert";
import { isSignalRecord, VaultServiceV2 } from "@toto-wolff/core";
import type { SignalRecord } from "@toto-wolff/core";

const MAX_RECORDS = 500; // P10 Rule 2 — upper bound on Signals/ directory scan
const MAX_RECORD_BYTES = 10_240; // P10 Rule 3 — reject oversized records

/**
 * Attempts JSON.parse on a value that looks like a JSON array.
 * On parse failure, logs a warning and returns [].
 * Observable via stderr — drop is never silent.
 */
function parseArrayValue(value: string, key: string, sourceHint: string): string[] {
  assert(typeof value === 'string', 'value must be a string');
  assert(typeof key === 'string', 'key must be a string');
  try {
    const parsed: unknown = JSON.parse(value);
    assert(Array.isArray(parsed), 'parsed value must be an array');
    return parsed as string[];
  } catch {
    console.warn(`[toto-wolff] parseFrontmatter: could not parse array field "${key}" in ${sourceHint} — stored as empty array`);
    return [];
  }
}

/**
 * Parses the YAML frontmatter of a vault signal record into a plain object.
 * Scalar fields stored as strings; inline JSON array fields (value starts with "[")
 * stored as string[]. Throws if no frontmatter block is found.
 */
function parseFrontmatter(raw: string, sourceHint: string): Record<string, unknown> {
  assert(typeof sourceHint === 'string', 'sourceHint must be a string');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert(match !== null, "no frontmatter block found");
  const block = match[1] ?? "";
  assert(block.length >= 0, "frontmatter block is a string");
  const result: Record<string, unknown> = {};
  const lines = block.split("\n");
  for (let i = 0; i < lines.length; i++) { // P10 Rule 2: bounded by lines.length (frontmatter is small)
    const line = lines[i] ?? "";
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key.length === 0) continue;
    if (value.trimStart().startsWith("[")) {
      result[key] = parseArrayValue(value, key, sourceHint);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * In-memory index of active SignalRecords loaded from VAULT_PATH/Signals/.
 * Call load() before querying. Supports filtering by pattern_tag frontmatter
 * field and returning all active records. Fresh load per request in spike scope.
 */
export class SignalIndex {
  private readonly vaultPath: string;
  private records: SignalRecord[] = [];
  private vaultPromise: Promise<VaultServiceV2> | null = null;

  constructor(vaultPath: string) {
    assert(vaultPath.length > 0, "vaultPath must be non-empty");
    this.vaultPath = vaultPath;
  }

  /**
   * Lazily construct (and memoize) the V2 vault facade for this instance.
   * On construction failure the memo is cleared so the next call retries.
   */
  private getVault(): Promise<VaultServiceV2> {
    if (this.vaultPromise === null) {
      this.vaultPromise = VaultServiceV2.create({ backend: "file", options: { rootPath: this.vaultPath } }).catch(
        (err: unknown) => {
          this.vaultPromise = null;
          throw err;
        },
      );
    }
    return this.vaultPromise;
  }

  /**
   * Loads all valid, non-expired SignalRecords from VAULT_PATH/Signals/.
   * Capped at MAX_RECORDS. Replaces any previously loaded records.
   */
  async load(): Promise<void> {
    const vault = await this.getVault();
    // listDir() already returns [] for a missing directory; other errors propagate.
    const entries = (await vault.listDir("Signals")).filter((e) => e.endsWith(".md")).slice(0, MAX_RECORDS);

    const now = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const loaded: SignalRecord[] = [];

    for (let i = 0; i < entries.length; i++) { // P10 Rule 2: bounded by entries.length <= MAX_RECORDS
      const entry = entries[i];
      if (entry == null) continue;
      let raw: string | null;
      try {
        raw = await vault.read(join("Signals", entry));
      } catch {
        continue;
      }
      if (raw === null) continue;
      // MAX_RECORD_BYTES is a byte-size cap; re-derive UTF-8 byte length
      // from the decoded string rather than truncating on character count.
      if (Buffer.byteLength(raw, "utf8") > MAX_RECORD_BYTES) continue;
      let fm: Record<string, unknown>;
      try {
        fm = parseFrontmatter(raw, entry);
      } catch {
        continue;
      }
      if (!isSignalRecord(fm)) continue;
      if ((fm.valid_until ?? "") < now) continue;
      loaded.push(fm as SignalRecord);
    }

    this.records = loaded;
  }

  /**
   * Returns all loaded SignalRecords whose topic_tags array contains patternTag
   * as an exact member. Returns all records if patternTag is empty.
   * Semantic: exact array membership, not substring match.
   */
  query(patternTag: string): SignalRecord[] {
    assert(typeof patternTag === "string", "patternTag must be a string");
    if (patternTag.length === 0) return this.records.slice();
    return this.records.filter((r) => (r.topic_tags ?? []).includes(patternTag));
  }

  /** Returns all loaded SignalRecords. */
  getAll(): SignalRecord[] {
    return this.records.slice();
  }
}
