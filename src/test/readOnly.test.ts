import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { Idbfs } from "../lib";

describe("readOnly", () => {
  let dbName: string;

  beforeEach(() => {
    dbName = `test-readonly-${Math.random()}`;
  });

  it("defaults to false", async () => {
    const fs = await new Idbfs({ dbName }).init();
    expect(fs.readOnly).toBe(false);
  });

  it("reflects the readOnly option", async () => {
    const fs = await new Idbfs({ dbName, readOnly: true }).init();
    expect(fs.readOnly).toBe(true);
  });

  it("rejects every mutating call once open", async () => {
    // seed some content with a writable handle to the same database first
    const seed = await new Idbfs({ dbName }).init();
    await seed.writeFile("/hello.txt", "hi");
    await seed.mkdir("/dir");

    const fs = await new Idbfs({ dbName, readOnly: true }).init();
    const entries = await fs.ls("/dir");
    const fileId = (await fs.stat("/hello.txt")).id;
    const dirId = (await fs.stat("/dir")).id;

    await expect(fs.writeFile("/new.txt", "x")).rejects.toThrow("read-only");
    await expect(fs.mkdir("/new-dir")).rejects.toThrow("read-only");
    await expect(fs.rm("/hello.txt")).rejects.toThrow("read-only");
    await expect(fs.rmdir("/dir")).rejects.toThrow("read-only");
    await expect(fs.mv("/hello.txt", "/moved.txt")).rejects.toThrow("read-only");
    await expect(fs.cp("/hello.txt", "/copy.txt")).rejects.toThrow("read-only");
    await expect(fs.renameNode(fileId, "renamed.txt")).rejects.toThrow("read-only");
    await expect(fs.mkdirUnder(dirId, "sub")).rejects.toThrow("read-only");
    await expect(fs.rmById(fileId)).rejects.toThrow("read-only");
    await expect(fs.rmDirById(dirId)).rejects.toThrow("read-only");
    await expect(fs.mvNode(fileId, dirId)).rejects.toThrow("read-only");
    await expect(fs.cpNode(fileId, dirId)).rejects.toThrow("read-only");

    expect(entries).toEqual([]);
  });

  it("still allows reads", async () => {
    const seed = await new Idbfs({ dbName }).init();
    await seed.writeFile("/hello.txt", "hi");

    const fs = await new Idbfs({ dbName, readOnly: true }).init();
    expect(await fs.exists("/hello.txt")).toBe(true);
    const file = await fs.readFile("/hello.txt");
    expect(new TextDecoder().decode(file.data)).toBe("hi");
    expect((await fs.ls("/")).map((e) => e.name)).toContain("hello.txt");
    expect((await fs.du("/")).files).toBe(1);
  });
});
