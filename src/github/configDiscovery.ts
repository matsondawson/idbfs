import type { Idbfs } from "../lib";
import { CONFIG_FILE } from "./syncMeta";

function join(dir: string, name: string): string {
  return dir === "/" ? `/${name}` : `${dir}/${name}`;
}

function parentOf(dir: string): string | null {
  if (dir === "/") return null;
  const parts = dir.split("/").filter(Boolean);
  parts.pop();
  return "/" + parts.join("/");
}

/**
 * Walks upward from `cwd` looking for `.githubsync.json`, the same way real
 * git walks up looking for `.git/`. Nearest ancestor wins — the search stops
 * at the first directory that has a config file.
 */
export async function findSyncRoot(fs: Idbfs, cwd: string): Promise<string | null> {
  let dir: string | null = fs.resolve(cwd);
  while (dir !== null) {
    if (await fs.exists(join(dir, CONFIG_FILE))) return dir;
    dir = parentOf(dir);
  }
  return null;
}
