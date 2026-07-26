import { describe, it, expect } from "vitest";
import { maskSensitiveCommand } from "../github/maskCommand";

describe("maskSensitiveCommand", () => {
  it("masks the token in a gh auth login command", () => {
    expect(maskSensitiveCommand("gh auth login ghp_abc123secret")).toBe("gh auth login ********");
  });

  it("is case-insensitive and tolerant of extra whitespace", () => {
    expect(maskSensitiveCommand("GH   AUTH   LOGIN   ghp_abc123")).toBe(
      "GH   AUTH   LOGIN   ********",
    );
  });

  it("leaves unrelated commands untouched", () => {
    expect(maskSensitiveCommand("gh push")).toBe("gh push");
    expect(maskSensitiveCommand("gh auth status")).toBe("gh auth status");
    expect(maskSensitiveCommand("ls /docs")).toBe("ls /docs");
  });

  it("leaves a bare 'gh auth login' with no token untouched", () => {
    expect(maskSensitiveCommand("gh auth login")).toBe("gh auth login");
  });
});
