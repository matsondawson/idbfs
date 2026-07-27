import { describe, it, expect } from "vitest";
import { formatGhError } from "../github/errors";

describe("formatGhError", () => {
  it("gives an actionable message for a rate-limit error", () => {
    const e = { status: 403, message: "API rate limit exceeded for 1.2.3.4." };
    expect(formatGhError(e)).toContain("sign in");
    expect(formatGhError(e)).toContain("Safe to retry");
  });

  it("passes through other errors unchanged", () => {
    const e = new Error("Not Found");
    expect(formatGhError(e)).toBe(String(e));
  });

  it("doesn't misclassify an unrelated 403", () => {
    const e = { status: 403, message: "Resource not accessible by integration" };
    expect(formatGhError(e)).toBe(String(e));
  });
});
