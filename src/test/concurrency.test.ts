import { describe, it, expect } from "vitest";
import { mapLimit } from "../github/concurrency";

describe("mapLimit", () => {
  it("preserves result order regardless of completion order", async () => {
    const delays = [30, 5, 20, 1, 10];
    const results = await mapLimit(delays, 5, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return i;
    });
    expect(results).toEqual([0, 1, 2, 3, 4]);
  });

  it("never runs more than `limit` at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);
    await mapLimit(items, 5, async (i) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return i;
    });
    expect(maxInFlight).toBeLessThanOrEqual(5);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it("reports progress as items complete", async () => {
    const progressCalls: Array<[number, number]> = [];
    await mapLimit(
      [1, 2, 3],
      5,
      async (n) => n,
      (done, total) => progressCalls.push([done, total]),
    );
    expect(progressCalls).toHaveLength(3);
    expect(progressCalls[progressCalls.length - 1]).toEqual([3, 3]);
  });

  it("handles an empty list", async () => {
    const results = await mapLimit([], 5, async (n: number) => n);
    expect(results).toEqual([]);
  });

  it("propagates a rejection", async () => {
    await expect(
      mapLimit([1, 2, 3], 5, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });
});
