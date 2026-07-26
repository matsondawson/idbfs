// Node >= 22 defines an experimental `localStorage` own-property on globalThis
// that is undefined unless --localstorage-file is passed, and it shadows the
// jsdom implementation vitest would otherwise expose. Replace it with an
// in-memory Storage stub so browser code under test can use localStorage.
if (!globalThis.localStorage) {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size;
      },
    } satisfies Storage,
  });
}
