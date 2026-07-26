import { describe, it, expect } from "vitest";
import "fake-indexeddb/auto";
import { openDB } from "../lib/db";

describe("openDB", () => {
  it("throws a clear error when IndexedDB is unavailable", async () => {
    const original = globalThis.indexedDB;
    // @ts-expect-error simulating a browser/environment without IndexedDB
    delete globalThis.indexedDB;
    try {
      await expect(openDB(`test-${Math.random()}`, 1)).rejects.toThrow(/not available/);
    } finally {
      globalThis.indexedDB = original;
    }
  });

  it("rejects instead of hanging when blocked by another open connection", async () => {
    const name = `test-blocked-${Math.random()}`;
    const first = await openDB(name, 1);
    await expect(openDB(name, 2)).rejects.toThrow(/blocked/);
    first.close();
  });
});
