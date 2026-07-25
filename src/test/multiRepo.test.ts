import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { Idbfs } from "../lib";
import { findSyncRoot } from "../github/configDiscovery";
import { readConfig, readState, writeState } from "../github/syncMeta";
import { initSyncRoot } from "../github/sync";

describe("per-directory sync configs", () => {
  let fs: Idbfs;

  beforeEach(async () => {
    fs = await new Idbfs({ dbName: `multirepo-${Math.random()}` }).init();
  });

  it("resolves different repos for sibling directories independently, even from nested cwds", async () => {
    await fs.mkdir("/projectA/src/deep");
    await fs.mkdir("/projectB");
    await initSyncRoot(fs, "/projectA", "alice", "repo-a", "main");
    await initSyncRoot(fs, "/projectB", "bob", "repo-b", "trunk");

    const rootFromDeepA = await findSyncRoot(fs, "/projectA/src/deep");
    const rootB = await findSyncRoot(fs, "/projectB");
    expect(rootFromDeepA).toBe("/projectA");
    expect(rootB).toBe("/projectB");

    const configFromDeepA = await readConfig(fs, rootFromDeepA!);
    const configB = await readConfig(fs, rootB!);
    expect(configFromDeepA?.owner).toBe("alice");
    expect(configFromDeepA?.repo).toBe("repo-a");
    expect(configB?.owner).toBe("bob");
    expect(configB?.repo).toBe("repo-b");
    expect(configB?.branch).toBe("trunk");
  });

  it("nested subdirectory config shadows its ancestor's", async () => {
    await fs.mkdir("/outer/inner");
    await initSyncRoot(fs, "/outer", "alice", "outer-repo", "main");
    await initSyncRoot(fs, "/outer/inner", "bob", "inner-repo", "main");

    expect(await findSyncRoot(fs, "/outer")).toBe("/outer");
    expect(await findSyncRoot(fs, "/outer/inner")).toBe("/outer/inner");
    const outerConfig = await readConfig(fs, (await findSyncRoot(fs, "/outer"))!);
    const innerConfig = await readConfig(fs, (await findSyncRoot(fs, "/outer/inner"))!);
    expect(outerConfig?.repo).toBe("outer-repo");
    expect(innerConfig?.repo).toBe("inner-repo");
  });

  it("sync state files don't leak between independently-configured directories", async () => {
    await fs.mkdir("/projectA");
    await fs.mkdir("/projectB");
    const configA = await initSyncRoot(fs, "/projectA", "alice", "repo-a", "main");
    const configB = await initSyncRoot(fs, "/projectB", "bob", "repo-b", "main");
    void configA;
    void configB;

    await writeState(fs, "/projectA", {
      lastSyncedCommit: "commitA",
      lastSyncedAt: 1,
      branch: "main",
      blobs: { "file.txt": "shaA" },
    });
    await writeState(fs, "/projectB", {
      lastSyncedCommit: "commitB",
      lastSyncedAt: 2,
      branch: "main",
      blobs: { "file.txt": "shaB" },
    });

    const stateA = await readState(fs, "/projectA");
    const stateB = await readState(fs, "/projectB");
    expect(stateA.lastSyncedCommit).toBe("commitA");
    expect(stateA.blobs["file.txt"]).toBe("shaA");
    expect(stateB.lastSyncedCommit).toBe("commitB");
    expect(stateB.blobs["file.txt"]).toBe("shaB");
  });

  it("a directory with no config of its own and no ancestor config resolves to null", async () => {
    await fs.mkdir("/unconfigured/deep/path");
    expect(await findSyncRoot(fs, "/unconfigured/deep/path")).toBeNull();
  });
});
