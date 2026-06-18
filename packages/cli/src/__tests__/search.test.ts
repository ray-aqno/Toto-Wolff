import { describe, it, expect } from "vitest";
import { parseRgOutput } from "../commands/search.js";

describe("parseRgOutput", () => {
  it("returns empty array for empty string", () => {
    expect(parseRgOutput("")).toEqual([]);
  });

  it("returns empty array for whitespace-only string", () => {
    expect(parseRgOutput("   \n   \n")).toEqual([]);
  });

  it("parses a single file path", () => {
    expect(parseRgOutput("/vault/P10-Plans/plan.md\n")).toEqual([
      "/vault/P10-Plans/plan.md",
    ]);
  });

  it("parses multiple file paths", () => {
    const input = "/a/b.md\n/c/d.md\n/e/f.md\n";
    expect(parseRgOutput(input)).toEqual(["/a/b.md", "/c/d.md", "/e/f.md"]);
  });

  it("trims whitespace from each line", () => {
    expect(parseRgOutput("  /a/b.md  \n")).toEqual(["/a/b.md"]);
  });

  it("skips empty lines between paths", () => {
    const input = "/a/b.md\n\n/c/d.md\n";
    expect(parseRgOutput(input)).toEqual(["/a/b.md", "/c/d.md"]);
  });

  it("caps results at 200 lines", () => {
    const lines = Array.from({ length: 300 }, (_, i) => `/file${i}.md`).join("\n");
    const result = parseRgOutput(lines);
    expect(result.length).toBeLessThanOrEqual(200);
  });
});
