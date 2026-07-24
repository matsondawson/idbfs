import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { Idbfs } from "../lib";
import { complete } from "../lib";

function makeFS() {
  return new Idbfs({ dbName: `test-complete-${Math.random()}` });
}

describe("complete", () => {
  let fs: Idbfs;

  beforeEach(async () => {
    fs = makeFS();
    await fs.init();
    await fs.writeFile("/readme.txt", "x");
    await fs.writeFile("/readme.md", "x");
    await fs.writeFile("/notes.txt", "x");
    await fs.mkdir("/docs");
    await fs.writeFile("/docs/api.txt", "x");
  });

  it("completes a unique command", async () => {
    const r = await complete("hel", "/", fs);
    expect(r.value).toBe("help ");
    expect(r.candidates).toEqual(["help"]);
  });

  it("completes to common prefix on multiple command matches", async () => {
    const r = await complete("r", "/", fs);
    expect(r.candidates).toEqual(expect.arrayContaining(["rm", "rmdir"]));
    expect(r.value).toBe("rm");
  });

  it("shows candidates when already at common prefix", async () => {
    const r = await complete("rm", "/", fs);
    expect(r.candidates).toEqual(expect.arrayContaining(["rm", "rmdir"]));
    expect(r.value).toBe(null);
  });

  it("completes empty input to all commands", async () => {
    const r = await complete("", "/", fs);
    expect(r.candidates.length).toBeGreaterThan(5);
  });

  it("completes a unique file", async () => {
    const r = await complete("ls note", "/", fs);
    expect(r.value).toBe("ls notes.txt ");
  });

  it("completes to common prefix on multiple file matches", async () => {
    const r = await complete("ls read", "/", fs);
    expect(r.value).toBe("ls readme.");
    expect(r.candidates).toEqual(expect.arrayContaining(["readme.txt", "readme.md"]));
  });

  it("shows candidates when no further common prefix", async () => {
    const r = await complete("ls readme.", "/", fs);
    expect(r.value).toBe(null);
    expect(r.candidates).toEqual(expect.arrayContaining(["readme.txt", "readme.md"]));
  });

  it("completes directory with trailing slash", async () => {
    const r = await complete("ls doc", "/", fs);
    expect(r.value).toBe("ls docs/");
  });

  it("completes file inside subdirectory", async () => {
    const r = await complete("view docs/api", "/", fs);
    expect(r.value).toBe("view docs/api.txt ");
  });

  it("returns no candidates for no match", async () => {
    const r = await complete("ls zzz", "/", fs);
    expect(r.value).toBe(null);
    expect(r.candidates).toHaveLength(0);
  });

  it("completes ./ as a path", async () => {
    const r = await complete("./note", "/", fs);
    expect(r.value).toBe("./notes.txt ");
  });

  it("completes ./ with no prefix lists all entries", async () => {
    const r = await complete("./", "/", fs);
    expect(r.candidates.length).toBeGreaterThan(0);
  });

  it("completes ../ path from a subdirectory", async () => {
    const r = await complete("../note", "/docs", fs);
    expect(r.value).toBe("../notes.txt ");
  });

  it("completes ../ with no prefix lists parent entries", async () => {
    const r = await complete("../", "/docs", fs);
    expect(r.candidates.length).toBeGreaterThan(0);
  });
});
