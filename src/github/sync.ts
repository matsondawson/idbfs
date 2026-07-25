import type { Idbfs } from "../lib";
import type { GitHubClient, TreeEntry } from "./client";
import { buildIgnoreMatcher } from "../lib/gitignore";
import { computeBlobSha1, arrayBufferToBase64, base64ToArrayBuffer } from "./blobsha";
import { CONFIG_FILE, STATE_FILE, readConfig, writeConfig, readState, writeState } from "./syncMeta";
import { mapLimit } from "./concurrency";
import type { SyncConfig, SyncState, ConflictInfo, PushResult, PullResult, StatusResult } from "./types";

const MAX_CONCURRENT_TRANSFERS = 5;
export type ProgressCallback = (done: number, total: number) => void;

function join(dir: string, name: string): string {
  return dir === "/" ? `/${name}` : `${dir}/${name}`;
}

function toRemotePath(config: SyncConfig, relPath: string): string {
  return config.remoteSubdir ? `${config.remoteSubdir}/${relPath}` : relPath;
}

/** returns null if the remote path isn't under the configured remoteSubdir */
function fromRemotePath(config: SyncConfig, remotePath: string): string | null {
  if (!config.remoteSubdir) return remotePath;
  const prefix = `${config.remoteSubdir}/`;
  return remotePath.startsWith(prefix) ? remotePath.slice(prefix.length) : null;
}

async function walk(
  fs: Idbfs,
  absDir: string,
  relDir: string,
  isIgnored: (relPath: string, isDir: boolean) => boolean,
  out: Array<{ relPath: string; data: ArrayBuffer }>,
  nestedRepos: string[],
): Promise<void> {
  const entries = await fs.ls(absDir);
  for (const entry of entries) {
    const relPath = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
    if (relPath === CONFIG_FILE || relPath === STATE_FILE) continue;
    if (entry.type === "dir") {
      if (isIgnored(relPath, true)) continue;
      // a subdirectory with its own sync config is an independent, nested
      // repo boundary — don't fold its content into this push, the same way
      // git doesn't descend into a nested repo's working tree.
      if (await fs.exists(join(entry.path, CONFIG_FILE))) {
        nestedRepos.push(relPath);
        continue;
      }
      await walk(fs, entry.path, relPath, isIgnored, out, nestedRepos);
    } else {
      if (isIgnored(relPath, false)) continue;
      const file = await fs.readFile(entry.path);
      out.push({ relPath, data: file.data });
    }
  }
}

export async function collectTrackedFiles(
  fs: Idbfs,
  syncRoot: string,
): Promise<{ files: Array<{ relPath: string; data: ArrayBuffer }>; nestedRepos: string[] }> {
  const isIgnored = await buildIgnoreMatcher(fs, syncRoot);
  const files: Array<{ relPath: string; data: ArrayBuffer }> = [];
  const nestedRepos: string[] = [];
  await walk(fs, syncRoot, "", isIgnored, files, nestedRepos);
  return { files, nestedRepos };
}

function isUnderNestedRepo(path: string, nestedRepos: string[]): boolean {
  return nestedRepos.some((n) => path === n || path.startsWith(`${n}/`));
}

interface ThreeWayDiff {
  localShas: Record<string, string>;
  remoteShas: Record<string, string>;
  conflicts: ConflictInfo[];
}

function diffThreeWay(
  localShas: Record<string, string>,
  remoteShas: Record<string, string>,
  baseShas: Record<string, string>,
): ConflictInfo[] {
  const paths = new Set([...Object.keys(localShas), ...Object.keys(remoteShas), ...Object.keys(baseShas)]);
  const conflicts: ConflictInfo[] = [];
  for (const path of paths) {
    const localSha = localShas[path];
    const remoteSha = remoteShas[path];
    const baseSha = baseShas[path];
    const localChanged = localSha !== baseSha;
    const remoteChanged = remoteSha !== baseSha;
    if (localChanged && remoteChanged && localSha !== remoteSha) {
      conflicts.push({
        path,
        localOnly: localSha !== undefined && baseSha === undefined,
        remoteOnly: remoteSha !== undefined && baseSha === undefined,
        localSha,
        remoteSha,
        baseSha,
      });
    }
  }
  return conflicts;
}

/** rejects anything that isn't a plain, non-escaping relative path — remote tree entries come from a repo we don't control */
export function isSafeRelPath(relPath: string): boolean {
  if (!relPath || relPath.startsWith("/")) return false;
  return relPath.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

async function loadRemoteTree(
  client: GitHubClient,
  config: SyncConfig,
): Promise<{ headSha: string | null; remoteShas: Record<string, string> }> {
  const headSha = await client.getRef(config.owner, config.repo, config.branch);
  if (!headSha) return { headSha: null, remoteShas: {} };
  const treeSha = await client.getCommitTreeSha(config.owner, config.repo, headSha);
  const rawTree = await client.getTreeRecursive(config.owner, config.repo, treeSha);
  const remoteShas: Record<string, string> = {};
  for (const [remotePath, sha] of Object.entries(rawTree)) {
    const relPath = fromRemotePath(config, remotePath);
    if (relPath === null || !isSafeRelPath(relPath)) continue;
    // never let a remote repo overwrite the sync engine's own control files —
    // otherwise a malicious repo could commit a fake .github/idbfs-sync.json
    // and silently redirect future pushes to an attacker-owned repo
    if (relPath === CONFIG_FILE || relPath === STATE_FILE) continue;
    remoteShas[relPath] = sha;
  }
  return { headSha, remoteShas };
}

async function computeLocalShas(files: Array<{ relPath: string; data: ArrayBuffer }>): Promise<Record<string, string>> {
  const shas: Record<string, string> = {};
  for (const file of files) shas[file.relPath] = await computeBlobSha1(file.data);
  return shas;
}

async function loadDiff(
  fs: Idbfs,
  syncRoot: string,
  client: GitHubClient,
  config: SyncConfig,
): Promise<ThreeWayDiff & { headSha: string | null; files: Array<{ relPath: string; data: ArrayBuffer }>; nestedRepos: string[] }> {
  const { files, nestedRepos } = await collectTrackedFiles(fs, syncRoot);
  const localShas = await computeLocalShas(files);
  const { headSha, remoteShas } = await loadRemoteTree(client, config);
  const state = await readState(fs, syncRoot);
  const conflicts = diffThreeWay(localShas, remoteShas, state.blobs);
  return { localShas, remoteShas, conflicts, headSha, files, nestedRepos };
}

export async function status(fs: Idbfs, syncRoot: string, client: GitHubClient, config: SyncConfig): Promise<StatusResult> {
  const { localShas, remoteShas, conflicts, nestedRepos } = await loadDiff(fs, syncRoot, client, config);
  const state = await readState(fs, syncRoot);
  const localChanged = Object.keys({ ...localShas, ...state.blobs }).filter((p) => localShas[p] !== state.blobs[p]);
  const remoteChanged = Object.keys({ ...remoteShas, ...state.blobs }).filter((p) => remoteShas[p] !== state.blobs[p]);
  return { localChanged, remoteChanged, conflicts, skippedNestedRepos: nestedRepos };
}

export async function push(
  fs: Idbfs,
  syncRoot: string,
  client: GitHubClient,
  config: SyncConfig,
  opts: { message?: string; force?: boolean; onProgress?: ProgressCallback } = {},
): Promise<PushResult> {
  const { localShas, remoteShas, conflicts, headSha, files, nestedRepos } = await loadDiff(fs, syncRoot, client, config);

  if (conflicts.length > 0 && !opts.force) {
    return { commitSha: "", uploaded: [], unchanged: [], conflicts, skippedNestedRepos: nestedRepos };
  }

  const message = opts.message ?? `idbfs sync: ${new Date().toISOString()}`;

  let effectiveHeadSha = headSha;
  const remoteBlobShaSet = new Set(Object.values(remoteShas));
  const uploaded: string[] = [];
  const unchanged: string[] = [];
  const finalShas: Record<string, string> = { ...localShas };

  let filesToUpload = files;
  if (effectiveHeadSha === null && files.length > 0) {
    const first = files[0];
    effectiveHeadSha = await client.bootstrapEmptyRepo(
      config.owner,
      config.repo,
      config.branch,
      toRemotePath(config, first.relPath),
      arrayBufferToBase64(first.data),
      message,
    );
    remoteBlobShaSet.add(localShas[first.relPath]);
    unchanged.push(first.relPath);
    filesToUpload = files.slice(1);
  }

  const uploadResults = await mapLimit(
    filesToUpload,
    MAX_CONCURRENT_TRANSFERS,
    async (file) => {
      const localSha = localShas[file.relPath];
      if (remoteBlobShaSet.has(localSha)) {
        return { relPath: file.relPath, sha: localSha, uploaded: false };
      }
      const sha = await client.createBlob(config.owner, config.repo, arrayBufferToBase64(file.data));
      return { relPath: file.relPath, sha, uploaded: true };
    },
    opts.onProgress,
  );
  for (const r of uploadResults) {
    finalShas[r.relPath] = r.sha;
    (r.uploaded ? uploaded : unchanged).push(r.relPath);
  }

  const treeEntries: TreeEntry[] = files.map((f) => ({
    path: toRemotePath(config, f.relPath),
    mode: "100644",
    type: "blob",
    sha: finalShas[f.relPath],
  }));

  // re-check the ref immediately before committing to shrink the race window
  const freshHeadSha = await client.getRef(config.owner, config.repo, config.branch);
  if (freshHeadSha !== effectiveHeadSha) {
    throw new Error("remote branch changed during push — run `gh pull` and try again");
  }

  const treeSha = await client.createTree(config.owner, config.repo, treeEntries);
  const commitSha = await client.createCommit(config.owner, config.repo, message, treeSha, freshHeadSha);

  if (freshHeadSha === null) {
    await client.createRef(config.owner, config.repo, config.branch, commitSha);
  } else {
    const ok = await client.updateRef(config.owner, config.repo, config.branch, commitSha);
    if (!ok) throw new Error("remote branch changed during push — run `gh pull` and try again");
  }

  const state = await readState(fs, syncRoot);
  const nextBlobs: Record<string, string> = { ...state.blobs };
  for (const f of files) nextBlobs[f.relPath] = finalShas[f.relPath];
  for (const path of Object.keys(state.blobs)) {
    if (!files.some((f) => f.relPath === path) && !conflicts.some((c) => c.path === path)) delete nextBlobs[path];
  }
  const nextState: SyncState = {
    lastSyncedCommit: commitSha,
    lastSyncedAt: Date.now(),
    branch: config.branch,
    blobs: nextBlobs,
  };
  await writeState(fs, syncRoot, nextState);

  return { commitSha, uploaded, unchanged, conflicts: [], skippedNestedRepos: nestedRepos };
}

type PullItemResult =
  | { path: string; kind: "conflict"; conflict: ConflictInfo }
  | { path: string; kind: "unchanged" | "noop" | "skippedNested" }
  | { path: string; kind: "deleted" }
  | { path: string; kind: "written"; sha: string };

export async function pull(
  fs: Idbfs,
  syncRoot: string,
  client: GitHubClient,
  config: SyncConfig,
  opts: { forcePaths?: string[] | "all"; onProgress?: ProgressCallback } = {},
): Promise<PullResult> {
  const { localShas, remoteShas, conflicts, headSha, nestedRepos } = await loadDiff(fs, syncRoot, client, config);
  const state = await readState(fs, syncRoot);

  const forceAll = opts.forcePaths === "all";
  const forceSet = new Set(Array.isArray(opts.forcePaths) ? opts.forcePaths : []);
  const isForced = (path: string) => forceAll || forceSet.has(path);
  const conflictByPath = new Map(conflicts.map((c) => [c.path, c]));

  const allPaths = [...new Set([...Object.keys(localShas), ...Object.keys(remoteShas)])];
  const results = await mapLimit(
    allPaths,
    MAX_CONCURRENT_TRANSFERS,
    async (path): Promise<PullItemResult> => {
      // a path under a nested repo's own boundary is that repo's business,
      // not this one's — never let a pull here write into or delete from it
      if (isUnderNestedRepo(path, nestedRepos)) return { path, kind: "skippedNested" };

      const conflict = conflictByPath.get(path);
      if (conflict && !isForced(path)) return { path, kind: "conflict", conflict };

      const remoteSha = remoteShas[path];
      const localSha = localShas[path];
      if (remoteSha === localSha) return { path, kind: remoteSha !== undefined ? "unchanged" : "noop" };

      const abs = join(syncRoot, path);
      if (remoteSha === undefined) {
        // deleted on remote
        if (await fs.exists(abs)) await fs.rm(abs);
        return { path, kind: "deleted" };
      }

      const base64 = await client.getBlob(config.owner, config.repo, remoteSha);
      await fs.writeFile(abs, base64ToArrayBuffer(base64));
      return { path, kind: "written", sha: remoteSha };
    },
    opts.onProgress,
  );

  const written: string[] = [];
  const unchanged: string[] = [];
  const skippedConflicts: ConflictInfo[] = [];
  const nextBlobs: Record<string, string> = { ...state.blobs };
  for (const r of results) {
    if (r.kind === "conflict") skippedConflicts.push(r.conflict);
    else if (r.kind === "unchanged") unchanged.push(r.path);
    else if (r.kind === "deleted") {
      delete nextBlobs[r.path];
      written.push(r.path);
    } else if (r.kind === "written") {
      nextBlobs[r.path] = r.sha;
      written.push(r.path);
    }
  }

  const nextState: SyncState = {
    lastSyncedCommit: headSha,
    lastSyncedAt: Date.now(),
    branch: config.branch,
    blobs: nextBlobs,
  };
  await writeState(fs, syncRoot, nextState);

  return { written, unchanged, skippedConflicts, skippedNestedRepos: nestedRepos };
}

export async function listBranches(client: GitHubClient, config: SyncConfig): Promise<string[]> {
  return client.listBranches(config.owner, config.repo);
}

export async function createBranch(client: GitHubClient, config: SyncConfig, name: string): Promise<void> {
  const headSha = await client.getRef(config.owner, config.repo, config.branch);
  if (!headSha) throw new Error(`current branch '${config.branch}' has no commits yet — push first`);
  await client.createRef(config.owner, config.repo, name, headSha);
}

export async function checkoutBranch(fs: Idbfs, syncRoot: string, config: SyncConfig, name: string): Promise<SyncConfig> {
  const next: SyncConfig = { ...config, branch: name };
  await writeConfig(fs, syncRoot, next);
  return next;
}

export async function initSyncRoot(fs: Idbfs, syncRoot: string, owner: string, repo: string, branch: string): Promise<SyncConfig> {
  const config: SyncConfig = { version: 1, owner, repo, branch, remoteSubdir: "" };
  await writeConfig(fs, syncRoot, config);
  return config;
}

/**
 * Matches `git clone`: creates a new subdirectory named after the repo
 * under `parentDir` and returns its path, rather than syncing into
 * `parentDir` itself. Refuses if that subdirectory already exists and has
 * content, the same way `git clone` does.
 */
export async function prepareCloneTarget(fs: Idbfs, parentDir: string, repoName: string): Promise<string> {
  const targetDir = parentDir === "/" ? `/${repoName}` : `${parentDir}/${repoName}`;
  if (await fs.exists(targetDir)) {
    const entries = await fs.ls(targetDir);
    if (entries.length > 0) throw new Error(`${targetDir} already exists and is not empty`);
  } else {
    await fs.mkdir(targetDir);
  }
  return targetDir;
}

export { readConfig };
