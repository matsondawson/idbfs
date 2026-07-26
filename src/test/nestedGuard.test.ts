import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { Idbfs } from "../lib";
import { ghCommand, warnIfNested } from "../github/commands";
import { clearToken } from "../github/auth";
import { readConfig } from "../github/syncMeta";

function outputText(output: { output: Array<{ kind: string; text?: string }> }): string {
  return output.output.map((l) => l.text ?? "").join("\n");
}

describe("gh init refuses to nest inside an existing repo by default", () => {
  let fs: Idbfs;

  beforeEach(async () => {
    fs = await new Idbfs({ dbName: `nested-guard-${Math.random()}` }).init();
    clearToken();
  });

  it("gh init succeeds in a fresh, unconfigured directory", async () => {
    await fs.mkdir("/project");
    const result = await ghCommand(["init", "alice/repo"], "/project", fs);
    expect(outputText(result)).toContain("initialized sync root");
    expect((await readConfig(fs, "/project"))?.repo).toBe("repo");
  });

  it("gh init is refused inside an already-configured directory tree", async () => {
    await fs.mkdir("/project/nested");
    await ghCommand(["init", "alice/outer-repo"], "/project", fs);

    const result = await ghCommand(["init", "bob/inner-repo"], "/project/nested", fs);
    expect(outputText(result)).toContain("already inside a repo synced to alice/outer-repo");
    expect(await fs.exists("/project/nested/.github/idbfs-sync.json")).toBe(false);
  });

  it("gh init --force overrides the nesting guard", async () => {
    await fs.mkdir("/project/nested");
    await ghCommand(["init", "alice/outer-repo"], "/project", fs);

    const result = await ghCommand(
      ["init", "bob/inner-repo", "main", "--force"],
      "/project/nested",
      fs,
    );
    expect(outputText(result)).toContain("initialized sync root");
    expect((await readConfig(fs, "/project/nested"))?.repo).toBe("inner-repo");
  });
});

describe("warnIfNested (the shared guard behind both gh init and gh clone)", () => {
  let fs: Idbfs;

  beforeEach(async () => {
    fs = await new Idbfs({ dbName: `warn-nested-${Math.random()}` }).init();
  });

  it("returns null when there's no ancestor repo", async () => {
    await fs.mkdir("/somewhere");
    expect(await warnIfNested(fs, "/somewhere", false)).toBeNull();
  });

  it("returns a warning naming the existing repo when nested", async () => {
    await fs.mkdir("/project/inner");
    await ghCommand(["init", "alice/outer-repo"], "/project", fs);

    const warning = await warnIfNested(fs, "/project/inner", false);
    expect(warning).not.toBeNull();
    expect(warning!.map((l) => ("text" in l ? l.text : "")).join(" ")).toContain(
      "alice/outer-repo",
    );
  });

  it("returns null (bypassed) when force is true, even when nested", async () => {
    await fs.mkdir("/project/inner");
    await ghCommand(["init", "alice/outer-repo"], "/project", fs);

    expect(await warnIfNested(fs, "/project/inner", true)).toBeNull();
  });
});
