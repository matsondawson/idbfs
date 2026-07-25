import ignore from "ignore";
import type { Idbfs } from "../lib";

interface RawGitignore {
  /** path of the directory containing this .gitignore, relative to sync root ("" = sync root itself) */
  relDir: string;
  lines: string[];
}

async function collectGitignores(fs: Idbfs, absDir: string, relDir: string, out: RawGitignore[]): Promise<void> {
  const entries = await fs.ls(absDir);
  const gitignoreEntry = entries.find((e) => e.type === "file" && e.name === ".gitignore");
  if (gitignoreEntry) {
    const file = await fs.readFile(gitignoreEntry.path);
    const lines = new TextDecoder().decode(file.data).split("\n");
    out.push({ relDir, lines });
  }
  for (const entry of entries) {
    if (entry.type === "dir") {
      const childRel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      await collectGitignores(fs, entry.path, childRel, out);
    }
  }
}

/**
 * Rewrites a single .gitignore line so it can be evaluated against paths
 * relative to the sync root instead of relative to the directory the
 * .gitignore file lives in. Per gitignore's own rules: a pattern containing
 * a "/" anywhere but the end is anchored to its own directory; a pattern
 * with no "/" (or only a trailing one) can match at any depth beneath it.
 * We emit both the zero-depth and nested-depth forms for the latter case
 * rather than relying on "**" zero-match support, to stay robust across
 * `ignore` package versions.
 */
function rewriteLine(relDir: string, rawLine: string): string[] {
  const line = rawLine.replace(/\r$/, "");
  if (!line.trim() || line.trimStart().startsWith("#")) return [];
  if (relDir === "") return [line];

  const negated = line.startsWith("!");
  const pattern = negated ? line.slice(1) : line;
  const prefix = negated ? "!" : "";

  const trailingSlash = pattern.endsWith("/");
  const bare = trailingSlash ? pattern.slice(0, -1) : pattern;
  const anchored = pattern.startsWith("/") || bare.includes("/");

  if (anchored) {
    const stripped = pattern.startsWith("/") ? pattern.slice(1) : pattern;
    return [`${prefix}${relDir}/${stripped}`];
  }
  return [`${prefix}${relDir}/${pattern}`, `${prefix}${relDir}/**/${pattern}`];
}

export type IgnoreMatcher = (relPath: string, isDir: boolean) => boolean;

/**
 * Builds a single predicate covering every .gitignore found anywhere under
 * `syncRoot`, cascaded per real git semantics (deeper rules layer on top of
 * shallower ones, including negations).
 */
export async function buildIgnoreMatcher(fs: Idbfs, syncRoot: string): Promise<IgnoreMatcher> {
  const raw: RawGitignore[] = [];
  await collectGitignores(fs, syncRoot, "", raw);
  raw.sort((a, b) => a.relDir.length - b.relDir.length);

  const ig = ignore();
  for (const { relDir, lines } of raw) {
    for (const line of lines) ig.add(rewriteLine(relDir, line));
  }

  return (relPath: string, isDir: boolean) => {
    if (!relPath) return false;
    return ig.ignores(isDir ? `${relPath}/` : relPath);
  };
}
