import type { Idbfs } from "../lib";
import type { CommandResult, OutputLine, ExtraCommand } from "../commands";
import { getToken, setToken, clearToken, whoami } from "./auth";
import { GitHubClient } from "./client";
import { findSyncRoot } from "./configDiscovery";
import { readConfig } from "./syncMeta";
import { push, pull, status, listBranches, createBranch, checkoutBranch, initSyncRoot, prepareCloneTarget } from "./sync";
import { parseRepoSpec } from "./repoSpec";
import { withActivity } from "./activity";
import type { SyncConfig, ConflictInfo } from "./types";

function text(t: string): OutputLine {
  return { kind: "text", text: t };
}
function error(t: string): OutputLine {
  return { kind: "error", text: t };
}
function ok(output: OutputLine[]): CommandResult {
  return { output };
}

async function requireContext(
  fs: Idbfs,
  cwd: string,
): Promise<{ syncRoot: string; config: SyncConfig; client: GitHubClient } | OutputLine[]> {
  const token = getToken();
  if (!token) return [error("not authenticated — run `gh auth login <token>` first")];

  const syncRoot = await findSyncRoot(fs, cwd);
  if (!syncRoot)
    return [
      error("no github sync configured here — run `gh clone <owner>/<repo>` to fetch an existing repo,"),
      error("or `gh init <owner>/<repo> [branch]` to sync this directory to a new one"),
    ];

  const config = await readConfig(fs, syncRoot);
  if (!config) return [error(`missing ${"`"}.githubsync.json${"`"} at ${syncRoot}`)];

  return { syncRoot, config, client: new GitHubClient(token) };
}

function fmtConflicts(conflicts: ConflictInfo[]): OutputLine[] {
  if (conflicts.length === 0) return [];
  const lines: OutputLine[] = [error(`${conflicts.length} conflict(s) — both local and remote changed since last sync:`)];
  for (const c of conflicts) lines.push(text(`  ${c.path}`));
  return lines;
}

function fmtNestedRepos(paths: string[]): OutputLine[] {
  if (paths.length === 0) return [];
  const lines: OutputLine[] = [text(`${paths.length} nested repo(s) skipped (they sync independently):`)];
  for (const p of paths) lines.push(text(`  ${p}`));
  return lines;
}

async function authCommand(args: string[]): Promise<CommandResult> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "login": {
      const token = rest[0];
      if (!token) return ok([error("usage: gh auth login <token>")]);
      try {
        const identity = await withActivity("Signing in...", () => whoami(token));
        setToken(token);
        return ok([text(`logged in as ${identity.login}`)]);
      } catch (e) {
        return ok([error(String(e))]);
      }
    }
    case "logout":
      clearToken();
      return ok([text("logged out")]);
    case "status": {
      const token = getToken();
      if (!token) return ok([text("not authenticated")]);
      try {
        const identity = await whoami(token);
        return ok([text(`authenticated as ${identity.login}`)]);
      } catch (e) {
        return ok([error(String(e))]);
      }
    }
    default:
      return ok([error("usage: gh auth <login|logout|status>")]);
  }
}

export async function warnIfNested(fs: Idbfs, parentDir: string, force: boolean): Promise<OutputLine[] | null> {
  if (force) return null;
  const existingRoot = await findSyncRoot(fs, parentDir);
  if (!existingRoot) return null;
  const existingConfig = await readConfig(fs, existingRoot);
  return [
    error(`${parentDir} is already inside a repo synced to ${existingConfig?.owner}/${existingConfig?.repo} (at ${existingRoot})`),
    error("pass --force if you really want a nested repo here"),
  ];
}

async function initCommand(fs: Idbfs, cwd: string, args: string[]): Promise<CommandResult> {
  const force = args.includes("--force");
  const [spec, branch] = args.filter((a) => a !== "--force");
  const parsed = spec ? parseRepoSpec(spec) : null;
  if (!parsed) return ok([error("usage: gh init <owner>/<repo>|<github-url> [branch] [--force]")]);
  const nestedWarning = await warnIfNested(fs, cwd, force);
  if (nestedWarning) return ok(nestedWarning);
  const config = await initSyncRoot(fs, cwd, parsed.owner, parsed.repo, branch ?? "main");
  return ok([text(`initialized sync root at ${cwd} -> ${config.owner}/${config.repo}@${config.branch}`)]);
}

async function cloneCommand(fs: Idbfs, cwd: string, args: string[]): Promise<CommandResult> {
  const force = args.includes("--force");
  const [spec, branch] = args.filter((a) => a !== "--force");
  const parsed = spec ? parseRepoSpec(spec) : null;
  if (!parsed) return ok([error("usage: gh clone <owner>/<repo>|<github-url> [branch] [--force]")]);
  const token = getToken();
  if (!token) return ok([error("not authenticated — run `gh auth login <token>` first")]);
  const nestedWarning = await warnIfNested(fs, cwd, force);
  if (nestedWarning) return ok(nestedWarning);

  try {
    const targetDir = await prepareCloneTarget(fs, cwd, parsed.repo);
    const config = await initSyncRoot(fs, targetDir, parsed.owner, parsed.repo, branch ?? "main");
    const client = new GitHubClient(token);
    const result = await withActivity(`Cloning ${parsed.owner}/${parsed.repo}...`, (onProgress) =>
      pull(fs, targetDir, client, config, { onProgress }),
    );
    const lines: OutputLine[] = [
      text(`cloned ${config.owner}/${config.repo}@${config.branch} into ${targetDir}`),
      text(`  ${result.written.length} written, ${result.unchanged.length} unchanged`),
    ];
    if (result.skippedConflicts.length > 0) {
      lines.push(error(`${result.skippedConflicts.length} path(s) already existed locally and were left alone:`));
      for (const c of result.skippedConflicts) lines.push(text(`  ${c.path}`));
    }
    lines.push(...fmtNestedRepos(result.skippedNestedRepos));
    return ok(lines);
  } catch (e) {
    return ok([error(String(e))]);
  }
}

async function remoteCommand(fs: Idbfs, cwd: string): Promise<CommandResult> {
  const syncRoot = await findSyncRoot(fs, cwd);
  if (!syncRoot) return ok([error("no github sync configured here")]);
  const config = await readConfig(fs, syncRoot);
  if (!config) return ok([error("missing .githubsync.json")]);
  return ok([
    text(`sync root: ${syncRoot}`),
    text(`remote:    ${config.owner}/${config.repo}`),
    text(`branch:    ${config.branch}`),
    text(`subdir:    ${config.remoteSubdir || "(repo root)"}`),
  ]);
}

async function pushCommand(fs: Idbfs, cwd: string, args: string[]): Promise<CommandResult> {
  const ctx = await requireContext(fs, cwd);
  if (Array.isArray(ctx)) return ok(ctx);
  const force = args.includes("--force");
  const mIdx = args.indexOf("-m");
  const message = mIdx !== -1 ? args.slice(mIdx + 1).join(" ") : undefined;
  try {
    const result = await withActivity(`Pushing to ${ctx.config.owner}/${ctx.config.repo}...`, (onProgress) =>
      push(fs, ctx.syncRoot, ctx.client, ctx.config, { message, force, onProgress }),
    );
    if (result.conflicts.length > 0) {
      return ok([error("push refused — resolve conflicts or use --force"), ...fmtConflicts(result.conflicts)]);
    }
    return ok([
      text(`pushed ${result.commitSha.slice(0, 7)} to ${ctx.config.owner}/${ctx.config.repo}@${ctx.config.branch}`),
      text(`  ${result.uploaded.length} uploaded, ${result.unchanged.length} unchanged`),
      ...fmtNestedRepos(result.skippedNestedRepos),
    ]);
  } catch (e) {
    return ok([error(String(e))]);
  }
}

async function pullCommand(fs: Idbfs, cwd: string, args: string[]): Promise<CommandResult> {
  const ctx = await requireContext(fs, cwd);
  if (Array.isArray(ctx)) return ok(ctx);
  let forcePaths: string[] | "all" | undefined;
  if (args.includes("--force-all")) forcePaths = "all";
  else {
    const fIdx = args.indexOf("--force");
    if (fIdx !== -1 && args[fIdx + 1]) forcePaths = [args[fIdx + 1]];
  }
  try {
    const result = await withActivity(`Pulling from ${ctx.config.owner}/${ctx.config.repo}...`, (onProgress) =>
      pull(fs, ctx.syncRoot, ctx.client, ctx.config, { forcePaths, onProgress }),
    );
    const lines: OutputLine[] = [text(`pulled: ${result.written.length} written, ${result.unchanged.length} unchanged`)];
    if (result.skippedConflicts.length > 0) {
      lines.push(error(`${result.skippedConflicts.length} conflict(s) skipped — use --force <path> or --force-all`));
      for (const c of result.skippedConflicts) lines.push(text(`  ${c.path}`));
    }
    lines.push(...fmtNestedRepos(result.skippedNestedRepos));
    return ok(lines);
  } catch (e) {
    return ok([error(String(e))]);
  }
}

async function statusCommand(fs: Idbfs, cwd: string): Promise<CommandResult> {
  const ctx = await requireContext(fs, cwd);
  if (Array.isArray(ctx)) return ok(ctx);
  try {
    const result = await withActivity(`Checking status of ${ctx.config.owner}/${ctx.config.repo}...`, () =>
      status(fs, ctx.syncRoot, ctx.client, ctx.config),
    );
    const lines: OutputLine[] = [];
    lines.push(text(`local changes:  ${result.localChanged.length ? result.localChanged.join(", ") : "(none)"}`));
    lines.push(text(`remote changes: ${result.remoteChanged.length ? result.remoteChanged.join(", ") : "(none)"}`));
    lines.push(...fmtConflicts(result.conflicts));
    lines.push(...fmtNestedRepos(result.skippedNestedRepos));
    return ok(lines);
  } catch (e) {
    return ok([error(String(e))]);
  }
}

async function branchCommand(fs: Idbfs, cwd: string, args: string[]): Promise<CommandResult> {
  const ctx = await requireContext(fs, cwd);
  if (Array.isArray(ctx)) return ok(ctx);
  try {
    if (args[0]) {
      await withActivity(`Creating branch ${args[0]}...`, () => createBranch(ctx.client, ctx.config, args[0]));
      return ok([text(`created branch ${args[0]} from ${ctx.config.branch}`)]);
    }
    const branches = await withActivity(`Loading branches for ${ctx.config.owner}/${ctx.config.repo}...`, () =>
      listBranches(ctx.client, ctx.config),
    );
    return ok(branches.map((b) => text(b === ctx.config.branch ? `* ${b}` : `  ${b}`)));
  } catch (e) {
    return ok([error(String(e))]);
  }
}

async function checkoutCommand(fs: Idbfs, cwd: string, args: string[]): Promise<CommandResult> {
  const ctx = await requireContext(fs, cwd);
  if (Array.isArray(ctx)) return ok(ctx);
  if (!args[0]) return ok([error("usage: gh checkout <branch>")]);
  await checkoutBranch(fs, ctx.syncRoot, ctx.config, args[0]);
  return ok([text(`switched to branch ${args[0]} (run 'gh pull' to sync its contents)`)]);
}

function helpCommand(): CommandResult {
  return ok(
    [
      "gh auth login <token>   store a github personal access token",
      "gh auth logout          clear the stored token",
      "gh auth status          show current identity",
      "gh clone <owner>/<repo>|<url> [branch] [--force]   create a subfolder and pull into it (--force to nest inside an existing repo)",
      "gh init <owner>/<repo> [branch] [--force]   configure sync for this directory without pulling",
      "gh remote                show the resolved sync config",
      "gh push [--force] [-m msg]   push local state to github",
      "gh pull [--force <path>|--force-all]   pull github state to local",
      "gh status                show local/remote changes and conflicts",
      "gh branch [name]          list branches, or create one",
      "gh checkout <branch>      switch the active branch (does not auto-pull)",
    ].map(text),
  );
}

export const ghCommand: ExtraCommand = async (args, cwd, fs) => {
  const [sub, ...rest] = args;
  switch (sub) {
    case "auth":
      return authCommand(rest);
    case "clone":
      return cloneCommand(fs, cwd, rest);
    case "init":
      return initCommand(fs, cwd, rest);
    case "remote":
      return remoteCommand(fs, cwd);
    case "push":
      return pushCommand(fs, cwd, rest);
    case "pull":
      return pullCommand(fs, cwd, rest);
    case "status":
      return statusCommand(fs, cwd);
    case "branch":
      return branchCommand(fs, cwd, rest);
    case "checkout":
      return checkoutCommand(fs, cwd, rest);
    case "help":
    case undefined:
      return helpCommand();
    default:
      return ok([error(`unknown gh subcommand: ${sub}. try 'gh help'`)]);
  }
};
