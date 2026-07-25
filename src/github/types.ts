export interface SyncConfig {
  version: 1;
  owner: string;
  repo: string;
  branch: string;
  remoteSubdir: string;
}

export interface SyncState {
  lastSyncedCommit: string | null;
  lastSyncedAt: number | null;
  branch: string;
  /** relative path -> git blob sha1, as of the last successful push or pull */
  blobs: Record<string, string>;
}

export interface ConflictInfo {
  path: string;
  /** local content changed since last sync but remote didn't have that path */
  localOnly?: boolean;
  /** remote content changed since last sync but local didn't have that path */
  remoteOnly?: boolean;
  localSha?: string;
  remoteSha?: string;
  baseSha?: string;
}

export interface PushResult {
  commitSha: string;
  uploaded: string[];
  unchanged: string[];
  conflicts: ConflictInfo[];
  /** relative paths of nested repos (their own .github/idbfs-sync.json) that were skipped, not folded in */
  skippedNestedRepos: string[];
}

export interface PullResult {
  written: string[];
  unchanged: string[];
  skippedConflicts: ConflictInfo[];
  skippedNestedRepos: string[];
}

export interface StatusResult {
  localChanged: string[];
  remoteChanged: string[];
  conflicts: ConflictInfo[];
  skippedNestedRepos: string[];
}
