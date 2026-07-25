import { useSyncExternalStore } from "react";
import { getActivity, subscribeActivity } from "./activity";
import "./GhTerminalStatusLine.css";

export function GhTerminalStatusLine() {
  const state = useSyncExternalStore(subscribeActivity, getActivity);
  if (!state.busy) return null;
  return (
    <div className="idbfs-gh-status-line">
      <span className="idbfs-gh-status-line__spinner" />
      {state.label ?? "working…"}
    </div>
  );
}
