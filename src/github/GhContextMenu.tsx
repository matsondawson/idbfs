import { useEffect, useState } from "react";
import type { Idbfs, ListEntry } from "../lib";
import { getToken } from "./auth";
import { GitHubClient } from "./client";
import { findSyncRoot } from "./configDiscovery";
import { readConfig } from "./syncMeta";
import { push, pull, status } from "./sync";
import { withActivity } from "./activity";
import { formatGhError } from "./errors";
import { openDialog } from "./dialogStore";
import type { SyncConfig } from "./types";

interface Resolved {
  syncRoot: string;
  config: SyncConfig;
}

export interface GhContextMenuItemsProps {
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
export function GhContextMenuItems({ fs, entry, onChanged, close }: GhContextMenuItemsProps) {
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

  const handleClone = () => {
    close();
    openDialog({ kind: "clone", parentPath: entry.path });
  };

  const handleInit = () => {
    close();
    openDialog({ kind: "init", parentPath: entry.path });
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
      onChanged?.();
      notify([formatGhError(e)]);
    }
  };

  const handlePull = async () => {
    close();
    if (!resolved) return;
    // no token required — public repos are readable anonymously, just at a
    // much lower rate limit; private repos will 404 and surface as an error
    const client = new GitHubClient(getToken() ?? undefined);
    try {
      const result = await withActivity(
        `Pulling from ${resolved.config.owner}/${resolved.config.repo}...`,
        (onProgress) => pull(fs, resolved.syncRoot, client, resolved.config, { onProgress }),
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
      // a failed pull can still have written some files before the error
      // (e.g. rate limit mid-transfer) — refresh so those aren't hidden
      onChanged?.();
      notify([formatGhError(e)]);
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
      onChanged?.();
      notify([formatGhError(e)]);
    }
  };

  const handleBranch = () => {
    close();
    if (!resolved) return;
    openDialog({ kind: "switchBranch", syncRoot: resolved.syncRoot, config: resolved.config });
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
          <div className="idbfs-tree__menu-item" onClick={handleBranch}>
            GitHub: Switch branch...
          </div>
        </>
      ) : (
        <>
          <div className="idbfs-tree__menu-item" onClick={handleClone}>
            GitHub: Clone repo into new folder...
          </div>
          <div className="idbfs-tree__menu-item" onClick={handleInit}>
            GitHub: Configure repo here...
          </div>
        </>
      )}
    </>
  );
}
