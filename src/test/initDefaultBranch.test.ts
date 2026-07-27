import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { Idbfs } from "../lib";
import { ghCommand } from "../github/commands";
import { clearToken } from "../github/auth";
import { readConfig } from "../github/syncMeta";

function outputText(result: { output: Array<{ kind: string; text?: string }> }): string {
  return result.output.map((l) => l.text ?? "").join("\n");
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("gh init resolves the default branch when none is given", () => {
  let fs: Idbfs;

  beforeEach(async () => {
    fs = await new Idbfs({ dbName: `init-branch-${Math.random()}` }).init();
    clearToken();
    await fs.mkdir("/project");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the repo's real default branch when the lookup succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { default_branch: "master" })),
    );
    const result = await ghCommand(["init", "alice/repo"], "/project", fs);
    expect(outputText(result)).toContain("@master");
    expect((await readConfig(fs, "/project"))?.branch).toBe("master");
  });

  it("falls back to main on a 404 (repo not created yet)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(404, { message: "Not Found" })),
    );
    const result = await ghCommand(["init", "alice/repo"], "/project", fs);
    expect(outputText(result)).toContain("@main");
    expect((await readConfig(fs, "/project"))?.branch).toBe("main");
  });

  it("surfaces a rate-limit failure instead of silently configuring main", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(403, { message: "API rate limit exceeded for 1.2.3.4." })),
    );
    const result = await ghCommand(["init", "alice/repo"], "/project", fs);
    expect(outputText(result)).toContain("rate limit");
    expect((await readConfig(fs, "/project"))?.branch).toBeUndefined();
  });
});
