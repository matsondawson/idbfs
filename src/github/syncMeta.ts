import type { Idbfs } from "../lib";
import type { SyncConfig, SyncState } from "./types";

/** kept inside .github/, alongside real GitHub metadata (workflows, etc.), the way .git/ holds git's own bookkeeping */
export const CONFIG_FILE = ".github/idbfs-sync.json";
export const STATE_FILE = ".github/idbfs-sync-state.json";

function join(dir: string, name: string): string {
  return dir === "/" ? `/${name}` : `${dir}/${name}`;
}

async function readJson<T>(fs: Idbfs, path: string): Promise<T | null> {
  if (!(await fs.exists(path))) return null;
  const file = await fs.readFile(path);
  return JSON.parse(new TextDecoder().decode(file.data)) as T;
}

async function writeJson(fs: Idbfs, path: string, value: unknown): Promise<void> {
  await fs.writeFile(path, JSON.stringify(value, null, 2) + "\n");
}

export async function readConfig(fs: Idbfs, syncRoot: string): Promise<SyncConfig | null> {
  return readJson<SyncConfig>(fs, join(syncRoot, CONFIG_FILE));
}

export async function writeConfig(fs: Idbfs, syncRoot: string, config: SyncConfig): Promise<void> {
  await writeJson(fs, join(syncRoot, CONFIG_FILE), config);
}

export async function readState(fs: Idbfs, syncRoot: string): Promise<SyncState> {
  const state = await readJson<SyncState>(fs, join(syncRoot, STATE_FILE));
  return state ?? { lastSyncedCommit: null, lastSyncedAt: null, branch: "", blobs: {} };
}

export async function writeState(fs: Idbfs, syncRoot: string, state: SyncState): Promise<void> {
  await writeJson(fs, join(syncRoot, STATE_FILE), state);
}
