import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { Idbfs } from "../lib";
import { collectTrackedFiles, initSyncRoot, prepareCloneTarget } from "../github/sync";
import { CONFIG_FILE, STATE_FILE } from "../github/syncMeta";

describe("sync boundaries and dotfile placement", () => {
  let fs: Idbfs;

  beforeEach(async () => {
    fs = await new Idbfs({ dbName: `boundaries-${Math.random()}` }).init();
  });

  it("keeps its own config/state files under .github/ and excludes only those two from what gets pushed", async () => {
    await initSyncRoot(fs, "/", "alice", "repo", "main");
    expect(await fs.exists(`/${CONFIG_FILE}`)).toBe(true);
    expect(CONFIG_FILE.startsWith(".github/")).toBe(true);
    expect(STATE_FILE.startsWith(".github/")).toBe(true);

    await fs.writeFile("/.github/workflows/ci.yml", "name: ci\n");
    await fs.writeFile("/README.md", "hello\n");

    const { files } = await collectTrackedFiles(fs, "/");
    const paths = files.map((f) => f.relPath).sort();
    expect(paths).toContain("README.md");
    expect(paths).toContain(".github/workflows/ci.yml");
    expect(paths).not.toContain(CONFIG_FILE);
    expect(paths).not.toContain(STATE_FILE);
  });

  it("does not fold a nested sync root's content into an outer push", async () => {
    await initSyncRoot(fs, "/", "alice", "outer-repo", "main");
    await fs.writeFile("/outer-file.txt", "outer\n");
    await fs.mkdir("/vendor/lib");
    await initSyncRoot(fs, "/vendor/lib", "bob", "inner-repo", "main");
    await fs.writeFile("/vendor/lib/inner-file.txt", "inner\n");

    const { files: outerFiles, nestedRepos } = await collectTrackedFiles(fs, "/");
    const outerPaths = outerFiles.map((f) => f.relPath);
    expect(outerPaths).toContain("outer-file.txt");
    expect(outerPaths).not.toContain("vendor/lib/inner-file.txt");
    expect(outerPaths.some((p) => p.startsWith("vendor/lib/"))).toBe(false);
    expect(nestedRepos).toEqual(["vendor/lib"]);

    const { files: innerFiles } = await collectTrackedFiles(fs, "/vendor/lib");
    const innerPaths = innerFiles.map((f) => f.relPath);
    expect(innerPaths).toContain("inner-file.txt");
  });

  it("prepareCloneTarget creates a subfolder named after the repo", async () => {
    const target = await prepareCloneTarget(fs, "/", "my-repo");
    expect(target).toBe("/my-repo");
    expect(await fs.exists("/my-repo")).toBe(true);
    const stat = await fs.stat("/my-repo");
    expect(stat.type).toBe("dir");
  });

  it("prepareCloneTarget refuses to clone into a non-empty existing folder", async () => {
    await fs.mkdir("/taken");
    await fs.writeFile("/taken/existing.txt", "already here\n");
    await expect(prepareCloneTarget(fs, "/", "taken")).rejects.toThrow(/already exists and is not empty/);
  });

  it("prepareCloneTarget reuses an existing empty folder without erroring", async () => {
    await fs.mkdir("/empty-dir");
    const target = await prepareCloneTarget(fs, "/", "empty-dir");
    expect(target).toBe("/empty-dir");
  });
});
