import type { SyncConfig } from "./types";

export type DialogRequest =
  | { kind: "clone"; parentPath: string }
  | { kind: "init"; parentPath: string }
  | { kind: "switchBranch"; syncRoot: string; config: SyncConfig };

type Listener = (req: DialogRequest | null) => void;

let current: DialogRequest | null = null;
let listeners: Listener[] = [];

/**
 * The context menu that opens these dialogs unmounts itself the instant an
 * item is clicked (same reason activity.ts exists), so the request has to
 * live outside that component's tree to survive past the click.
 */
export function openDialog(req: DialogRequest): void {
  current = req;
  for (const l of listeners) l(current);
}

export function closeDialog(): void {
  current = null;
  for (const l of listeners) l(current);
}

export function getDialogRequest(): DialogRequest | null {
  return current;
}

export function subscribeDialog(fn: Listener): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}
