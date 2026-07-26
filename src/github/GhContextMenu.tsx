import { useEffect, useState } from "react";
import type { Idbfs, ListEntry } from "../lib";
import { getToken } from "./auth";
import { GitHubClient } from "./client";
import { findSyncRoot } from "./configDiscovery";
import { readConfig } from "./syncMeta";
import {
  push,
  pull,
  status,
  initSyncRoot,
  listBranches,
  createBranch,
  checkoutBranch,
  prepareCloneTarget,
} from "./sync";
import { parseRepoSpec } from "./repoSpec";
import { withActivity } from "./activity";
import type { SyncConfig } from "./types";

interface Resolved {
  syncRoot: string;
  config: SyncConfig;
}

interface Props {
  fs: Idbfs;
  entry: ListEntry;
  onChanged?: () => void;
  close: () => void;
}

function notify(lines: string[]): void {
  window.alert(lines.join("\n"));
}

function fmtNested(paths: string[]): string[] {
  return paths.length > 0
    ? [
        `${paths.length} nested repo(s) skipped (they sync independently):`,
        ...paths.map((p) => `  ${p}`),
      ]
    : [];
}

function requireToken(): string | null {
  const token = getToken();
  if (!token) notify(["not authenticated — use the GitHub button in the toolbar to sign in first"]);
  return token;
}

/**
 * Renders the GitHub sync actions for whichever folder was right-clicked in
 * the tree, scoped to that folder's own nearest `.githubsync.json` — not a
 * single global repo. Each node can be configured against a different repo.
 */
export function GhContextMenuItems({ fs, entry, onChanged, close }: Props) {
  const [resolved, setResolved] = useState<Resolved | null | undefined>(undefined);

  useEffect(() => {
    if (entry.type !== "dir") return;
    let cancelled = false;
    (async () => {
      const syncRoot = await findSyncRoot(fs, entry.path);
      if (cancelled) return;
      if (!syncRoot) {
        setResolved(null);
        return;
      }
      const config = await readConfig(fs, syncRoot);
      if (cancelled) return;
      setResolved(config ? { syncRoot, config } : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [fs, entry.type, entry.path]);

  if (entry.type !== "dir" || resolved === undefined) return null;

  const handleClone = async () => {
    close();
    const token = requireToken();
    if (!token) return;
    const spec = window.prompt(
      "Clone which repo? (owner/repo or github.com URL) — creates a new subfolder here",
    );
    if (!spec) return;
    const parsed = parseRepoSpec(spec);
    if (!parsed) return notify(["invalid repo — use owner/repo or a github.com URL"]);
    const branch = window.prompt("Branch:", "main") || "main";
    try {
      const targetDir = await prepareCloneTarget(fs, entry.path, parsed.repo);
      const config = await initSyncRoot(fs, targetDir, parsed.owner, parsed.repo, branch);
      const result = await withActivity(`Cloning ${parsed.owner}/${parsed.repo}...`, (onProgress) =>
        pull(fs, targetDir, new GitHubClient(token), config, { onProgress }),
      );
      onChanged?.();
      notify([
        `cloned ${config.owner}/${config.repo}@${config.branch} into ${targetDir}`,
        `${result.written.length} written, ${result.unchanged.length} unchanged`,
      ]);
    } catch (e) {
      notify([String(e)]);
    }
  };

  const handleInit = async () => {
    close();
    const spec = window.prompt(
      "Configure this folder to sync with which repo? (owner/repo or github.com URL)",
    );
    if (!spec) return;
    const parsed = parseRepoSpec(spec);
    if (!parsed) return notify(["invalid repo — use owner/repo or a github.com URL"]);
    const branch = window.prompt("Branch:", "main") || "main";
    const config = await initSyncRoot(fs, entry.path, parsed.owner, parsed.repo, branch);
    onChanged?.();
    notify([`configured ${entry.path} -> ${config.owner}/${config.repo}@${config.branch}`]);
  };

  const handlePush = async () => {
    close();
    if (!resolved) return;
    const token = requireToken();
    if (!token) return;
    try {
      const result = await withActivity(
        `Pushing to ${resolved.config.owner}/${resolved.config.repo}...`,
        (onProgress) =>
          push(fs, resolved.syncRoot, new GitHubClient(token), resolved.config, { onProgress }),
      );
      onChanged?.();
      if (result.conflicts.length > 0) {
        notify(["push refused — conflicts:", ...result.conflicts.map((c) => `  ${c.path}`)]);
      } else {
        notify([
          `pushed ${result.commitSha.slice(0, 7)}`,
          `${result.uploaded.length} uploaded, ${result.unchanged.length} unchanged`,
          ...fmtNested(result.skippedNestedRepos),
        ]);
      }
    } catch (e) {
      notify([String(e)]);
    }
  };

  const handlePull = async () => {
    close();
    if (!resolved) return;
    const token = requireToken();
    if (!token) return;
    try {
      const result = await withActivity(
        `Pulling from ${resolved.config.owner}/${resolved.config.repo}...`,
        (onProgress) =>
          pull(fs, resolved.syncRoot, new GitHubClient(token), resolved.config, { onProgress }),
      );
      onChanged?.();
      const lines = [
        `pulled: ${result.written.length} written, ${result.unchanged.length} unchanged`,
      ];
      if (result.skippedConflicts.length > 0) {
        lines.push("conflicts skipped:", ...result.skippedConflicts.map((c) => `  ${c.path}`));
      }
      lines.push(...fmtNested(result.skippedNestedRepos));
      notify(lines);
    } catch (e) {
      notify([String(e)]);
    }
  };

  const handleStatus = async () => {
    close();
    if (!resolved) return;
    const token = requireToken();
    if (!token) return;
    try {
      const result = await withActivity(
        `Checking status of ${resolved.config.owner}/${resolved.config.repo}...`,
        () => status(fs, resolved.syncRoot, new GitHubClient(token), resolved.config),
      );
      notify([
        `local:  ${result.localChanged.length ? result.localChanged.join(", ") : "(none)"}`,
        `remote: ${result.remoteChanged.length ? result.remoteChanged.join(", ") : "(none)"}`,
        ...(result.conflicts.length
          ? ["conflicts:", ...result.conflicts.map((c) => `  ${c.path}`)]
          : []),
        ...fmtNested(result.skippedNestedRepos),
      ]);
    } catch (e) {
      notify([String(e)]);
    }
  };

  const handleBranch = async () => {
    close();
    if (!resolved) return;
    const token = requireToken();
    if (!token) return;
    try {
      const client = new GitHubClient(token);
      const branches = await withActivity(
        `Loading branches for ${resolved.config.owner}/${resolved.config.repo}...`,
        () => listBranches(client, resolved.config),
      );
      const name = window.prompt(
        `Branches: ${branches.join(", ")}\n\nSwitch to (or type a new name to create it):`,
        resolved.config.branch,
      );
      if (!name || name === resolved.config.branch) return;
      if (!branches.includes(name)) {
        if (
          !window.confirm(
            `Branch '${name}' doesn't exist — create it from ${resolved.config.branch}?`,
          )
        )
          return;
        await withActivity(`Creating branch ${name}...`, () =>
          createBranch(client, resolved.config, name),
        );
      }
      await checkoutBranch(fs, resolved.syncRoot, resolved.config, name);
      onChanged?.();
      notify([`switched to ${name} — run Pull to sync its contents`]);
    } catch (e) {
      notify([String(e)]);
    }
  };

  return (
    <>
      <div className="idbfs-tree__divider" />
      {resolved ? (
        <>
          <div className="idbfs-tree__menu-item" onClick={() => void handlePush()}>
            GitHub: Push ({resolved.config.owner}/{resolved.config.repo}@{resolved.config.branch})
          </div>
          <div className="idbfs-tree__menu-item" onClick={() => void handlePull()}>
            GitHub: Pull
          </div>
          <div className="idbfs-tree__menu-item" onClick={() => void handleStatus()}>
            GitHub: Status
          </div>
          <div className="idbfs-tree__menu-item" onClick={() => void handleBranch()}>
            GitHub: Switch branch...
          </div>
        </>
      ) : (
        <>
          <div className="idbfs-tree__menu-item" onClick={() => void handleClone()}>
            GitHub: Clone repo into new folder...
          </div>
          <div className="idbfs-tree__menu-item" onClick={() => void handleInit()}>
            GitHub: Configure repo here...
          </div>
        </>
      )}
    </>
  );
}
