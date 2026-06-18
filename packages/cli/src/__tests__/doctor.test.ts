import { describe, it, expect } from "vitest";
import { checkEnv } from "../commands/doctor.js";

describe("checkEnv", () => {
  it("returns true when ANTHROPIC_AUTH_TOKEN is set", () => {
    expect(checkEnv({ ANTHROPIC_AUTH_TOKEN: "tok_abc" })).toBe(true);
  });

  it("returns true when ANTHROPIC_API_KEY is set", () => {
    expect(checkEnv({ ANTHROPIC_API_KEY: "sk-abc" })).toBe(true);
  });

  it("returns true when both are set (prefers AUTH_TOKEN)", () => {
    expect(
      checkEnv({ ANTHROPIC_AUTH_TOKEN: "tok_abc", ANTHROPIC_API_KEY: "sk-abc" })
    ).toBe(true);
  });

  it("returns false when neither key is present", () => {
    expect(checkEnv({})).toBe(false);
  });

  it("returns false when ANTHROPIC_AUTH_TOKEN is empty string", () => {
    expect(checkEnv({ ANTHROPIC_AUTH_TOKEN: "" })).toBe(false);
  });

  it("returns false when ANTHROPIC_API_KEY is empty string and AUTH_TOKEN absent", () => {
    expect(checkEnv({ ANTHROPIC_API_KEY: "" })).toBe(false);
  });

  it("returns false when both are undefined", () => {
    expect(checkEnv({ ANTHROPIC_AUTH_TOKEN: undefined, ANTHROPIC_API_KEY: undefined })).toBe(false);
  });
});
