export interface ActivityState {
  busy: boolean;
  label?: string;
}

type Listener = (state: ActivityState) => void;

let current: ActivityState = { busy: false };
let listeners: Listener[] = [];

/**
 * A single global "something's happening" signal for GitHub actions.
 * Needed because the context menu that triggers push/pull/clone unmounts
 * itself the instant an action is clicked, so nothing in that component's
 * own tree survives long enough to show progress — this outlives it.
 */
export function setActivity(busy: boolean, label?: string): void {
  current = { busy, label };
  for (const l of listeners) l(current);
}

export function getActivity(): ActivityState {
  return current;
}

export function subscribeActivity(fn: Listener): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

/** wraps an async action, showing `label` (optionally with live progress) while it runs */
export async function withActivity<T>(
  label: string,
  fn: (onProgress: (done: number, total: number) => void) => Promise<T>,
): Promise<T> {
  setActivity(true, label);
  try {
    return await fn((done, total) => setActivity(true, `${label} (${done}/${total})`));
  } finally {
    setActivity(false);
  }
}
