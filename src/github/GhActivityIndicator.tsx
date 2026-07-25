import { useSyncExternalStore } from "react";
import { getActivity, subscribeActivity } from "./activity";
import "./GhActivityIndicator.css";

export function GhActivityIndicator() {
  const state = useSyncExternalStore(subscribeActivity, getActivity);
  if (!state.busy) return null;
  return (
    <div className="idbfs-gh-activity">
      <span className="idbfs-gh-activity__spinner" />
      {state.label ?? "working…"}
    </div>
  );
}
