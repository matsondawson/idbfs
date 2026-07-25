import { describe, it, expect } from "vitest";
import { setActivity, getActivity, subscribeActivity, withActivity } from "../github/activity";

describe("activity store", () => {
  it("notifies subscribers and updates getActivity()", () => {
    const seen: Array<{ busy: boolean; label?: string }> = [];
    const unsubscribe = subscribeActivity((s) => seen.push(s));
    setActivity(true, "pushing");
    setActivity(false);
    unsubscribe();
    expect(seen).toEqual([{ busy: true, label: "pushing" }, { busy: false, label: undefined }]);
    expect(getActivity()).toEqual({ busy: false, label: undefined });
  });

  it("stops notifying after unsubscribe", () => {
    const seen: Array<{ busy: boolean; label?: string }> = [];
    const unsubscribe = subscribeActivity((s) => seen.push(s));
    unsubscribe();
    setActivity(true, "pulling");
    expect(seen).toHaveLength(0);
    setActivity(false);
  });

  it("withActivity sets busy during the action and clears it after, reporting progress", async () => {
    const seen: Array<{ busy: boolean; label?: string }> = [];
    const unsubscribe = subscribeActivity((s) => seen.push({ ...s }));
    const result = await withActivity("pushing", async (onProgress) => {
      onProgress(1, 2);
      onProgress(2, 2);
      return "done";
    });
    unsubscribe();
    expect(result).toBe("done");
    expect(seen[0]).toEqual({ busy: true, label: "pushing" });
    expect(seen[1]).toEqual({ busy: true, label: "pushing (1/2)" });
    expect(seen[2]).toEqual({ busy: true, label: "pushing (2/2)" });
    expect(seen[3]).toEqual({ busy: false, label: undefined });
  });

  it("withActivity still clears busy when the action throws", async () => {
    const unsubscribe = subscribeActivity(() => {});
    await expect(
      withActivity("pulling", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    unsubscribe();
    expect(getActivity()).toEqual({ busy: false, label: undefined });
  });
});
