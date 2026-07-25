import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { Idbfs } from "../lib";
import { buildIgnoreMatcher } from "../github/gitignore";

describe("buildIgnoreMatcher", () => {
  let fs: Idbfs;

  beforeEach(async () => {
    fs = await new Idbfs({ dbName: `test-${Math.random()}` }).init();
  });

  it("ignores a root-level pattern anywhere at any depth when unslashed", async () => {
    await fs.writeFile("/.gitignore", "*.log\n");
    await fs.mkdir("/src");
    const match = await buildIgnoreMatcher(fs, "/");
    expect(match("app.log", false)).toBe(true);
    expect(match("src/app.log", false)).toBe(true);
    expect(match("src/app.ts", false)).toBe(false);
  });

  it("anchors a leading-slash pattern to the gitignore's own directory", async () => {
    await fs.writeFile("/.gitignore", "/build\n");
    await fs.mkdir("/src/build");
    const match = await buildIgnoreMatcher(fs, "/");
    expect(match("build", true)).toBe(true);
    expect(match("src/build", true)).toBe(false);
  });

  it("cascades nested .gitignore files under a sync root", async () => {
    await fs.mkdir("/proj/pkg");
    await fs.writeFile("/proj/.gitignore", "*.tmp\n");
    await fs.writeFile("/proj/pkg/.gitignore", "dist\n");
    const match = await buildIgnoreMatcher(fs, "/proj");
    expect(match("a.tmp", false)).toBe(true);
    expect(match("pkg/b.tmp", false)).toBe(true);
    expect(match("pkg/dist", true)).toBe(true);
    expect(match("dist", true)).toBe(false);
  });

  it("supports negation to re-include a file within an ignored pattern", async () => {
    await fs.writeFile("/.gitignore", "*.log\n!important.log\n");
    const match = await buildIgnoreMatcher(fs, "/");
    expect(match("debug.log", false)).toBe(true);
    expect(match("important.log", false)).toBe(false);
  });

  it("returns a no-op matcher when there is no .gitignore", async () => {
    await fs.mkdir("/proj");
    const match = await buildIgnoreMatcher(fs, "/proj");
    expect(match("anything.ts", false)).toBe(false);
  });
});
