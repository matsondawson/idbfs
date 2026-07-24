import type { Idbfs } from "./idbfs";

const COMMANDS = [
  "cd",
  "clear",
  "cp",
  "du",
  "help",
  "ls",
  "mkdir",
  "mv",
  "pwd",
  "rm",
  "rmdir",
  "stat",
  "view",
];

export interface CompletionResult {
  value: string | null;
  candidates: string[];
}

export async function complete(input: string, cwd: string, fs: Idbfs): Promise<CompletionResult> {
  const m = input.match(/^(.*\s)?(\S*)$/);
  if (!m) return { value: null, candidates: [] };

  const before = m[1] ?? "";
  const partial = m[2];
  const isFirstToken = before.trim() === "";

  const isPath = partial.startsWith("./") || partial.startsWith("/") || partial.startsWith("..");

  if (isFirstToken && !isPath) {
    const matches = COMMANDS.filter((c) => c.startsWith(partial));
    if (matches.length === 0) return { value: null, candidates: [] };
    if (matches.length === 1) return { value: matches[0] + " ", candidates: matches };
    const common = commonPrefix(matches);
    return {
      value: common.length > partial.length ? common : null,
      candidates: matches,
    };
  }

  const lastSlash = partial.lastIndexOf("/");
  const dirPart = lastSlash === -1 ? "" : partial.slice(0, lastSlash) || "/";
  const prefix = partial.slice(lastSlash + 1);
  const dirToList = dirPart === "" ? cwd : fs.resolve(dirPart, cwd);

  let entries;
  try {
    entries = await fs.ls(dirToList);
  } catch {
    return { value: null, candidates: [] };
  }

  const matches = entries.filter((e) => e.name.startsWith(prefix));
  if (matches.length === 0) return { value: null, candidates: [] };

  const base = lastSlash === -1 ? "" : partial.slice(0, lastSlash + 1);

  if (matches.length === 1) {
    const suffix = matches[0].type === "dir" ? "/" : " ";
    return {
      value: before + base + matches[0].name + suffix,
      candidates: [matches[0].name],
    };
  }

  const names = matches.map((e) => e.name);
  const common = commonPrefix(names);
  return {
    value: common.length > prefix.length ? before + base + common : null,
    candidates: names,
  };
}

function commonPrefix(strs: string[]): string {
  if (strs.length === 0) return "";
  let prefix = strs[0];
  for (const s of strs.slice(1)) {
    while (!s.startsWith(prefix)) prefix = prefix.slice(0, -1);
    if (prefix === "") return "";
  }
  return prefix;
}
