import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Idbfs } from "../lib";
import { getToken } from "./auth";
import { GitHubClient } from "./client";
import { pull, initSyncRoot, prepareCloneTarget, checkoutBranch, createBranch } from "./sync";
import { parseRepoSpec } from "./repoSpec";
import { withActivity } from "./activity";
import { formatGhError } from "./errors";
import { getDialogRequest, subscribeDialog, closeDialog } from "./dialogStore";
import "./GhRepoDialog.css";

interface Props {
  fs: Idbfs;
  onChanged?: () => void;
}

interface BranchPickState {
  owner: string;
  repo: string;
  branches: string[];
  /** clone can only check out a branch that already exists; init/switch can name one that doesn't (yet) */
  allowFreeText: boolean;
  confirmLabel: string;
  /** present-participle for the working-state message — not derived from confirmLabel, since naive `+ "ing"` mangles verbs like "Clone" -> "Cloneing" */
  workingLabel: string;
  onConfirm: (branch: string) => Promise<string>;
  /** the default (clone/init) or current (switch) branch — sorted first and pre-highlighted so Enter alone confirms it, without hiding the rest of the list the way pre-filling the filter box would */
  pinned?: { branch: string; label: string };
}

/** pinned branch first, everything else alphabetical — never hide branches behind a pre-typed filter */
function sortBranches(branches: string[], pinned?: string): string[] {
  return [...branches].sort((a, b) => {
    if (a === pinned) return -1;
    if (b === pinned) return 1;
    return a.localeCompare(b);
  });
}

type Phase =
  | { kind: "repoInput" }
  | { kind: "branchPick"; state: BranchPickState }
  | { kind: "working"; label: string }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

interface Item {
  value: string;
  create: boolean;
}

export function GhRepoDialog({ fs, onChanged }: Props) {
  const request = useSyncExternalStore(subscribeDialog, getDialogRequest);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [spec, setSpec] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "repoInput" });
  const [filter, setFilter] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (request && !el.open) el.showModal();
    if (!request && el.open) el.close();
  }, [request]);

  useEffect(() => {
    if (!request) return;
    setSpec("");
    setFilter("");
    setHighlighted(0);
    setError(null);

    if (request.kind === "switchBranch") {
      const { syncRoot, config } = request;
      const client = new GitHubClient(getToken() ?? undefined);
      setPhase({ kind: "working", label: "Loading branches..." });
      client
        .listBranches(config.owner, config.repo)
        .then((branches) => {
          // the dialog may have been closed (or reopened for something else)
          // while this was in flight — never let a stale response clobber the
          // current request's state
          if (getDialogRequest() !== request) return;
          setPhase({
            kind: "branchPick",
            state: {
              owner: config.owner,
              repo: config.repo,
              branches: sortBranches(branches, config.branch),
              allowFreeText: true,
              confirmLabel: "Switch",
              workingLabel: "Switching",
              pinned: { branch: config.branch, label: "current" },
              onConfirm: async (branch) => {
                if (!branches.includes(branch)) {
                  const token = getToken();
                  if (!token) throw new Error("not authenticated — sign in to create a new branch");
                  await createBranch(new GitHubClient(token), config, branch);
                }
                await checkoutBranch(fs, syncRoot, config, branch);
                onChanged?.();
                return `switched to ${branch} — run Pull to sync its contents`;
              },
            },
          });
        })
        .catch((e: unknown) => {
          if (getDialogRequest() !== request) return;
          // must leave the "working" phase — it renders no error and no
          // buttons, so staying there would show "Loading branches..." forever
          setPhase({ kind: "error", message: formatGhError(e) });
        });
    } else {
      setPhase({ kind: "repoInput" });
    }
    // deliberately keyed on `request` only: `onChanged` is a fresh closure
    // every time FileTree re-renders (unrelated to this dialog), and
    // resetting whenever that identity changes would wipe progress mid-flow
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  if (!request) {
    return <dialog ref={dialogRef} className="idbfs-gh-dialog" onClose={closeDialog} />;
  }

  const submitSpec = async () => {
    const parsed = parseRepoSpec(spec);
    if (!parsed) return setError("invalid repo — use owner/repo or a github.com URL");
    if (request.kind === "switchBranch") return;
    setError(null);

    // no token required — public repos are readable anonymously, just at a
    // much lower rate limit; private repos will 404 and surface as an error
    const client = new GitHubClient(getToken() ?? undefined);
    const parentPath = request.parentPath;
    const isClone = request.kind === "clone";

    setPhase({ kind: "working", label: `Looking up ${parsed.owner}/${parsed.repo}...` });
    try {
      let branches: string[];
      let defaultBranch: string;
      try {
        [branches, defaultBranch] = await Promise.all([
          client.listBranches(parsed.owner, parsed.repo),
          client.getDefaultBranch(parsed.owner, parsed.repo),
        ]);
      } catch (e) {
        // for `init` the repo may not exist yet (this can bootstrap a brand
        // new remote on first push) — but only a 404 means that; anything
        // else (rate limit, network) must surface rather than silently
        // configuring "main" for a repo whose real default may differ
        if (isClone || (e as { status?: unknown }).status !== 404) throw e;
        branches = [];
        defaultBranch = "main";
      }

      if (getDialogRequest() !== request) return;
      // nothing to pin against when the repo has no branches yet (a fresh
      // `init` target) — pre-fill the filter with the fallback name instead,
      // since there's no list to hide by doing so in that case
      if (branches.length === 0) setFilter(defaultBranch);
      setPhase({
        kind: "branchPick",
        state: {
          owner: parsed.owner,
          repo: parsed.repo,
          branches: sortBranches(branches, defaultBranch),
          allowFreeText: !isClone,
          confirmLabel: isClone ? "Clone" : "Configure",
          workingLabel: isClone ? "Cloning" : "Configuring",
          pinned: { branch: defaultBranch, label: "default" },
          onConfirm: async (branch) => {
            if (isClone) {
              const targetDir = await prepareCloneTarget(fs, parentPath, parsed.repo);
              const config = await initSyncRoot(fs, targetDir, parsed.owner, parsed.repo, branch);
              const result = await withActivity(
                `Cloning ${parsed.owner}/${parsed.repo}...`,
                (onProgress) => pull(fs, targetDir, client, config, { onProgress }),
              );
              onChanged?.();
              return `cloned ${config.owner}/${config.repo}@${config.branch} into ${targetDir} — ${result.written.length} written, ${result.unchanged.length} unchanged`;
            }
            const config = await initSyncRoot(fs, parentPath, parsed.owner, parsed.repo, branch);
            onChanged?.();
            return `configured ${parentPath} -> ${config.owner}/${config.repo}@${config.branch}`;
          },
        },
      });
    } catch (e) {
      if (getDialogRequest() !== request) return;
      setError(formatGhError(e));
      setPhase({ kind: "repoInput" });
    }
  };

  const runConfirm = async (branch: string, state: BranchPickState) => {
    setError(null);
    setPhase({ kind: "working", label: `${state.workingLabel}...` });
    try {
      const message = await state.onConfirm(branch);
      if (getDialogRequest() !== request) return;
      setPhase({ kind: "done", message });
    } catch (e) {
      // a failed clone/pull can still have written some files before the
      // error (e.g. rate limit mid-transfer) — refresh so those aren't hidden
      onChanged?.();
      if (getDialogRequest() !== request) return;
      setError(formatGhError(e));
      setPhase({ kind: "branchPick", state });
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="idbfs-gh-dialog"
      onClose={closeDialog}
      onClick={(e) => {
        // don't let a stray backdrop click dismiss the dialog mid-operation —
        // the work would keep running but its outcome message would be lost
        if (e.target === dialogRef.current && phase.kind !== "working") closeDialog();
      }}
    >
      {phase.kind === "repoInput" && (
        <div className="idbfs-gh-dialog__body">
          <div className="idbfs-gh-dialog__title">
            {request.kind === "clone" ? "Clone repo" : "Configure GitHub sync"}
          </div>
          <input
            className="idbfs-gh-dialog__input"
            placeholder="owner/repo or github.com URL"
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submitSpec()}
            autoFocus
          />
          {error && <div className="idbfs-gh-dialog__error">{error}</div>}
          <div className="idbfs-gh-dialog__actions">
            <button type="button" onClick={closeDialog}>
              Cancel
            </button>
            <button type="button" disabled={!spec.trim()} onClick={() => void submitSpec()}>
              Next
            </button>
          </div>
        </div>
      )}

      {phase.kind === "branchPick" &&
        (() => {
          const { state } = phase;
          const q = filter.trim().toLowerCase();
          const matches: Item[] = state.branches
            .filter((b) => b.toLowerCase().includes(q))
            .map((value) => ({ value, create: false }));
          const showCreate =
            state.allowFreeText && filter.trim() !== "" && !state.branches.includes(filter.trim());
          const items: Item[] = showCreate ? [...matches, { value: filter.trim(), create: true }] : matches;
          const activeIndex = Math.min(highlighted, Math.max(items.length - 1, 0));

          return (
            <div className="idbfs-gh-dialog__body">
              <div className="idbfs-gh-dialog__title">
                {state.owner}/{state.repo}
              </div>
              <input
                className="idbfs-gh-dialog__input"
                placeholder="Filter branches..."
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setHighlighted(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setHighlighted((h) => Math.min(h + 1, items.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setHighlighted((h) => Math.max(h - 1, 0));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    const picked = items[activeIndex];
                    if (picked) void runConfirm(picked.value, state);
                  }
                }}
                autoFocus
                role="combobox"
                aria-expanded
                aria-controls="idbfs-gh-dialog-listbox"
              />
              <ul className="idbfs-gh-dialog__list" id="idbfs-gh-dialog-listbox" role="listbox">
                {items.length === 0 && (
                  <li className="idbfs-gh-dialog__empty">
                    {state.branches.length === 0 ? "no branches — repo may be empty" : "no matching branches"}
                  </li>
                )}
                {items.map((item, i) => (
                  <li
                    key={item.value}
                    role="option"
                    aria-selected={i === activeIndex}
                    className={
                      i === activeIndex
                        ? "idbfs-gh-dialog__item idbfs-gh-dialog__item--active"
                        : "idbfs-gh-dialog__item"
                    }
                    onClick={() => void runConfirm(item.value, state)}
                  >
                    {item.create ? (
                      `Create branch "${item.value}"`
                    ) : item.value === state.pinned?.branch ? (
                      <>
                        {item.value} <span className="idbfs-gh-dialog__pinned">({state.pinned.label})</span>
                      </>
                    ) : (
                      item.value
                    )}
                  </li>
                ))}
              </ul>
              {error && <div className="idbfs-gh-dialog__error">{error}</div>}
              <div className="idbfs-gh-dialog__actions">
                <button type="button" onClick={closeDialog}>
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={items.length === 0}
                  onClick={() => items[activeIndex] && void runConfirm(items[activeIndex].value, state)}
                >
                  {state.confirmLabel}
                </button>
              </div>
            </div>
          );
        })()}

      {phase.kind === "working" && (
        <div className="idbfs-gh-dialog__body">
          <div className="idbfs-gh-dialog__working">{phase.label}</div>
        </div>
      )}

      {phase.kind === "done" && (
        <div className="idbfs-gh-dialog__body">
          <div className="idbfs-gh-dialog__done">{phase.message}</div>
          <div className="idbfs-gh-dialog__actions">
            <button type="button" onClick={closeDialog} autoFocus>
              Close
            </button>
          </div>
        </div>
      )}

      {phase.kind === "error" && (
        <div className="idbfs-gh-dialog__body">
          <div className="idbfs-gh-dialog__error">{phase.message}</div>
          <div className="idbfs-gh-dialog__actions">
            <button type="button" onClick={closeDialog} autoFocus>
              Close
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
