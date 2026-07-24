import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { Idbfs } from "../lib";

function makeFS() {
  return new Idbfs({ dbName: `test-${Math.random()}` });
}

describe("Idbfs", () => {
  let fs: Idbfs;

  beforeEach(async () => {
    fs = makeFS();
    await fs.init();
  });

  it("root exists after init", async () => {
    expect(await fs.exists("/")).toBe(true);
  });

  it("ls root returns empty array initially", async () => {
    const entries = await fs.ls("/");
    expect(entries).toHaveLength(0);
  });

  it("mkdir creates a directory", async () => {
    await fs.mkdir("docs");
    const entries = await fs.ls("/");
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("docs");
    expect(entries[0].type).toBe("dir");
  });

  it("mkdir creates nested directories", async () => {
    await fs.mkdir("/a/b/c");
    expect(await fs.exists("/a")).toBe(true);
    expect(await fs.exists("/a/b")).toBe(true);
    expect(await fs.exists("/a/b/c")).toBe(true);
  });

  it("writeFile creates a file", async () => {
    await fs.writeFile("hello.txt", "hello world");
    expect(await fs.exists("hello.txt")).toBe(true);
  });

  it("readFile returns file content", async () => {
    const content = "hello world";
    await fs.writeFile("hello.txt", content);
    const file = await fs.readFile("hello.txt");
    expect(new TextDecoder().decode(file.data)).toBe(content);
  });

  it("writeFile creates parent dirs automatically", async () => {
    await fs.writeFile("/docs/readme.txt", "content");
    expect(await fs.exists("/docs")).toBe(true);
    expect(await fs.exists("/docs/readme.txt")).toBe(true);
  });

  it("rm removes a file", async () => {
    await fs.writeFile("tmp.txt", "x");
    await fs.rm("tmp.txt");
    expect(await fs.exists("tmp.txt")).toBe(false);
  });

  it("rm throws on directory", async () => {
    await fs.mkdir("mydir");
    await expect(fs.rm("mydir")).rejects.toThrow("is a directory");
  });

  it("rmdir removes empty directory", async () => {
    await fs.mkdir("emptydir");
    await fs.rmdir("emptydir");
    expect(await fs.exists("emptydir")).toBe(false);
  });

  it("rmdir throws on non-empty directory", async () => {
    await fs.mkdir("nonempty");
    await fs.writeFile("/nonempty/file.txt", "x");
    await expect(fs.rmdir("nonempty")).rejects.toThrow("directory not empty");
  });

  it("rmdir throws on root", async () => {
    await expect(fs.rmdir("/")).rejects.toThrow("cannot remove root");
  });

  it("stat returns metadata without data", async () => {
    await fs.writeFile("note.txt", "hi");
    const meta = await fs.stat("note.txt");
    expect(meta.type).toBe("file");
    expect(meta.size).toBe(2);
    expect("data" in meta).toBe(false);
  });

  it("resolve normalizes paths", () => {
    expect(fs.resolve("../foo", "/bar/baz")).toBe("/bar/foo");
    expect(fs.resolve("./x", "/a")).toBe("/a/x");
    expect(fs.resolve("/", "/wherever")).toBe("/");
  });

  it("ls sorts dirs before files then alphabetically", async () => {
    await fs.writeFile("/z.txt", "");
    await fs.mkdir("/a-dir");
    await fs.writeFile("/a.txt", "");
    const entries = await fs.ls("/");
    expect(entries[0].name).toBe("a-dir");
    expect(entries[1].name).toBe("a.txt");
    expect(entries[2].name).toBe("z.txt");
  });

  it("writeFile overwrites existing file", async () => {
    await fs.writeFile("data.txt", "v1");
    await fs.writeFile("data.txt", "version2");
    const file = await fs.readFile("data.txt");
    expect(new TextDecoder().decode(file.data)).toBe("version2");
  });

  it("exists returns false for missing path", async () => {
    expect(await fs.exists("/nope")).toBe(false);
  });

  it("readFile throws on directory", async () => {
    await fs.mkdir("d");
    await expect(fs.readFile("d")).rejects.toThrow("is a directory");
  });

  it("mv renames a file", async () => {
    await fs.writeFile("old.txt", "hello");
    await fs.mv("old.txt", "new.txt");
    expect(await fs.exists("old.txt")).toBe(false);
    const file = await fs.readFile("new.txt");
    expect(new TextDecoder().decode(file.data)).toBe("hello");
  });

  it("mv moves a file into a directory", async () => {
    await fs.writeFile("file.txt", "x");
    await fs.mkdir("docs");
    await fs.mv("file.txt", "docs");
    expect(await fs.exists("file.txt")).toBe(false);
    expect(await fs.exists("/docs/file.txt")).toBe(true);
  });

  it("mv moves a file to a new path creating parent dirs", async () => {
    await fs.writeFile("a.txt", "y");
    await fs.mv("a.txt", "/deep/path/b.txt");
    expect(await fs.exists("/deep/path/b.txt")).toBe(true);
    expect(await fs.exists("a.txt")).toBe(false);
  });

  it("mv moves a directory", async () => {
    await fs.mkdir("/src/sub");
    await fs.writeFile("/src/a.txt", "a");
    await fs.writeFile("/src/sub/b.txt", "b");
    await fs.mv("/src", "/dst");
    expect(await fs.exists("/src")).toBe(false);
    expect(await fs.exists("/dst/a.txt")).toBe(true);
    expect(await fs.exists("/dst/sub/b.txt")).toBe(true);
  });

  it("mv directory into existing directory", async () => {
    await fs.mkdir("/src");
    await fs.writeFile("/src/file.txt", "x");
    await fs.mkdir("/dest");
    await fs.mv("/src", "/dest");
    expect(await fs.exists("/dest/src/file.txt")).toBe(true);
    expect(await fs.exists("/src")).toBe(false);
  });

  it("mv throws when moving directory into itself", async () => {
    await fs.mkdir("/a/b");
    await expect(fs.mv("/a", "/a/b/c")).rejects.toThrow("itself");
  });

  it("cp copies a file to a new name", async () => {
    await fs.writeFile("a.txt", "hello");
    await fs.cp("a.txt", "b.txt");
    expect(await fs.exists("a.txt")).toBe(true);
    const copy = await fs.readFile("b.txt");
    expect(new TextDecoder().decode(copy.data)).toBe("hello");
  });

  it("cp copies a file into a directory", async () => {
    await fs.writeFile("a.txt", "hi");
    await fs.mkdir("docs");
    await fs.cp("a.txt", "docs");
    expect(await fs.exists("a.txt")).toBe(true);
    expect(await fs.exists("/docs/a.txt")).toBe(true);
  });

  it("cp errors if destination file already exists", async () => {
    await fs.writeFile("a.txt", "v1");
    await fs.writeFile("b.txt", "v2");
    await expect(fs.cp("a.txt", "b.txt")).rejects.toThrow("file already exists");
  });

  it("cp errors if src and dest are the same", async () => {
    await fs.writeFile("a.txt", "x");
    await expect(fs.cp("a.txt", "a.txt")).rejects.toThrow("same");
  });

  it("cp copies a directory recursively", async () => {
    await fs.mkdir("/src/sub");
    await fs.writeFile("/src/a.txt", "a");
    await fs.writeFile("/src/sub/b.txt", "b");
    await fs.cp("/src", "/dst");
    expect(await fs.exists("/dst/a.txt")).toBe(true);
    expect(await fs.exists("/dst/sub/b.txt")).toBe(true);
    expect(await fs.exists("/src/a.txt")).toBe(true);
  });

  it("cp directory into existing directory", async () => {
    await fs.mkdir("/src");
    await fs.writeFile("/src/file.txt", "x");
    await fs.mkdir("/dest");
    await fs.cp("/src", "/dest");
    expect(await fs.exists("/dest/src/file.txt")).toBe(true);
  });

  it("cp throws when copying directory into itself", async () => {
    await fs.mkdir("/a/b");
    await expect(fs.cp("/a", "/a/b/c")).rejects.toThrow("itself");
  });

  it("du returns file count and size", async () => {
    await fs.writeFile("/a.txt", "hello");
    await fs.writeFile("/b.txt", "world!");
    const stats = await fs.du("/");
    expect(stats.files).toBe(2);
    expect(stats.size).toBe(11);
  });

  it("du recurses into subdirectories", async () => {
    await fs.writeFile("/docs/a.txt", "hi");
    await fs.writeFile("/docs/sub/b.txt", "there");
    const stats = await fs.du("/");
    expect(stats.files).toBe(2);
    expect(stats.dirs).toHaveLength(1);
    expect(stats.dirs[0].dirs).toHaveLength(1);
  });
});
