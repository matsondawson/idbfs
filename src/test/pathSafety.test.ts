import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { Idbfs } from "../lib";
import { isSafeRelPath, pull, initSyncRoot } from "../github/sync";
import { CONFIG_FILE, STATE_FILE, readConfig } from "../github/syncMeta";
import { arrayBufferToBase64 } from "../github/blobsha";
import type { GitHubClient } from "../github/client";

describe("isSafeRelPath", () => {
  it("accepts plain relative paths", () => {
    expect(isSafeRelPath("README.md")).toBe(true);
    expect(isSafeRelPath("src/index.ts")).toBe(true);
    expect(isSafeRelPath("a/b/c.txt")).toBe(true);
  });

  it("rejects traversal segments", () => {
    expect(isSafeRelPath("../etc/passwd")).toBe(false);
    expect(isSafeRelPath("a/../../b")).toBe(false);
    expect(isSafeRelPath("..")).toBe(false);
  });

  it("rejects absolute-looking and empty paths", () => {
    expect(isSafeRelPath("/etc/passwd")).toBe(false);
    expect(isSafeRelPath("")).toBe(false);
    expect(isSafeRelPath("a//b")).toBe(false);
  });

  it("rejects a bare current-directory segment", () => {
    expect(isSafeRelPath("./foo")).toBe(false);
    expect(isSafeRelPath("a/./b")).toBe(false);
  });
});

function fakeClient(tree: Record<string, string>, blobs: Record<string, string>): GitHubClient {
  return {
    getRef: async () => "deadbeef",
    getCommitTreeSha: async () => "treesha",
    getTreeRecursive: async () => tree,
    getBlob: async (_owner: string, _repo: string, sha: string) => blobs[sha],
  } as unknown as GitHubClient;
}

describe("pull() refuses to let a remote repo overwrite sync control files or escape the sync root", () => {
  let fs: Idbfs;

  beforeEach(async () => {
    fs = await new Idbfs({ dbName: `pathsafety-${Math.random()}` }).init();
  });

  it("never writes a remote-supplied .github/idbfs-sync.json over the real one", async () => {
    const config = await initSyncRoot(fs, "/", "real-owner", "real-repo", "main");
    const maliciousConfig = JSON.stringify({
      version: 1,
      owner: "attacker",
      repo: "exfil",
      branch: "main",
      remoteSubdir: "",
    });
    const blobSha = "malicious-sha";
    const client = fakeClient(
      { [CONFIG_FILE]: blobSha, [STATE_FILE]: "another-sha", "hello.txt": "hello-sha" },
      {
        [blobSha]: arrayBufferToBase64(
          new TextEncoder().encode(maliciousConfig).buffer as ArrayBuffer,
        ),
        "another-sha": "",
        "hello-sha": arrayBufferToBase64(new TextEncoder().encode("hi\n").buffer as ArrayBuffer),
      },
    );

    await pull(fs, "/", client, config);

    const stillReal = await readConfig(fs, "/");
    expect(stillReal?.owner).toBe("real-owner");
    expect(stillReal?.repo).toBe("real-repo");

    const helloFile = await fs.readFile("/hello.txt");
    expect(new TextDecoder().decode(helloFile.data)).toBe("hi\n");
  });

  it("ignores a remote tree entry with a path-traversal name", async () => {
    const config = await initSyncRoot(fs, "/nested", "owner", "repo", "main");
    const client = fakeClient(
      { "../escaped.txt": "evil-sha", "safe.txt": "safe-sha" },
      {
        "evil-sha": arrayBufferToBase64(new TextEncoder().encode("pwned\n").buffer as ArrayBuffer),
        "safe-sha": arrayBufferToBase64(new TextEncoder().encode("ok\n").buffer as ArrayBuffer),
      },
    );

    await pull(fs, "/nested", client, config);

    expect(await fs.exists("/escaped.txt")).toBe(false);
    const safe = await fs.readFile("/nested/safe.txt");
    expect(new TextDecoder().decode(safe.data)).toBe("ok\n");
  });
});
