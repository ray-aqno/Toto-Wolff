import { describe, it, expect } from "vitest";
import { mergeSettings } from "../commands/init.js";

describe("mergeSettings", () => {
  it("inserts toto-wolff entry when mcpServers is absent", () => {
    const result = mergeSettings({});
    const mcp = result["mcpServers"] as Record<string, unknown>;
    expect(mcp).toBeDefined();
    expect(mcp["toto-wolff"]).toBeDefined();
  });

  it("inserts toto-wolff entry when mcpServers exists but key is missing", () => {
    const input = { mcpServers: { "other-server": { type: "stdio" } } };
    const result = mergeSettings(input);
    const mcp = result["mcpServers"] as Record<string, unknown>;
    expect(mcp["toto-wolff"]).toBeDefined();
    expect(mcp["other-server"]).toBeDefined();
  });

  it("does not overwrite an existing toto-wolff entry", () => {
    const existing = { command: "original" };
    const input = { mcpServers: { "toto-wolff": existing } };
    const result = mergeSettings(input);
    const mcp = result["mcpServers"] as Record<string, unknown>;
    expect(mcp["toto-wolff"]).toBe(existing);
  });

  it("does not mutate the input object", () => {
    const input: Record<string, unknown> = {};
    mergeSettings(input);
    expect(input["mcpServers"]).toBeUndefined();
  });

  it("preserves unrelated top-level keys", () => {
    const input = { apiKey: "abc", mcpServers: {} };
    const result = mergeSettings(input);
    expect(result["apiKey"]).toBe("abc");
  });
});
