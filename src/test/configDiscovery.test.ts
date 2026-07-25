import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { Idbfs } from "../lib";
import { findSyncRoot } from "../github/configDiscovery";
import { CONFIG_FILE } from "../github/syncMeta";

describe("findSyncRoot", () => {
  let fs: Idbfs;

  beforeEach(async () => {
    fs = await new Idbfs({ dbName: `test-${Math.random()}` }).init();
  });

  it("returns null when no config file exists anywhere", async () => {
    await fs.mkdir("/a/b/c");
    expect(await findSyncRoot(fs, "/a/b/c")).toBeNull();
  });

  it("finds a config file at cwd itself", async () => {
    await fs.mkdir("/proj");
    await fs.writeFile(`/proj/${CONFIG_FILE}`, "{}");
    expect(await findSyncRoot(fs, "/proj")).toBe("/proj");
  });

  it("walks upward to find the nearest ancestor config", async () => {
    await fs.mkdir("/proj/src/deep");
    await fs.writeFile(`/proj/${CONFIG_FILE}`, "{}");
    expect(await findSyncRoot(fs, "/proj/src/deep")).toBe("/proj");
  });

  it("nearest ancestor wins over a further one", async () => {
    await fs.mkdir("/proj/sub/inner");
    await fs.writeFile(`/proj/${CONFIG_FILE}`, "{}");
    await fs.writeFile(`/proj/sub/${CONFIG_FILE}`, "{}");
    expect(await findSyncRoot(fs, "/proj/sub/inner")).toBe("/proj/sub");
  });

  it("finds a config file at root", async () => {
    await fs.mkdir("/a/b");
    await fs.writeFile(`/${CONFIG_FILE}`, "{}");
    expect(await findSyncRoot(fs, "/a/b")).toBe("/");
  });
});
