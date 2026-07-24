import type { Node } from "./types";

const STORE = "filenode";
export const ROOT_ID = "root";

export async function openDB(name: string, version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      for (const old of ["entries", "nodes"]) {
        if (db.objectStoreNames.contains(old)) db.deleteObjectStore(old);
      }
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("parentId", "parentId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function getById(db: IDBDatabase, id: string): Promise<Node | undefined> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result as Node | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function getChildByName(
  db: IDBDatabase,
  parentId: string,
  name: string,
): Promise<Node | undefined> {
  const children = await getChildrenOf(db, parentId);
  return children.find((c) => c.name === name);
}

export function getChildrenOf(db: IDBDatabase, parentId: string): Promise<Node[]> {
  return new Promise((resolve, reject) => {
    const idx = db.transaction(STORE, "readonly").objectStore(STORE).index("parentId");
    const req = idx.getAll(parentId);
    req.onsuccess = () => resolve(req.result as Node[]);
    req.onerror = () => reject(req.error);
  });
}

export function getAll(db: IDBDatabase): Promise<Node[]> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as Node[]);
    req.onerror = () => reject(req.error);
  });
}

export function put(db: IDBDatabase, node: Node): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    t.objectStore(STORE).put(node);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export function del(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    t.objectStore(STORE).delete(id);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}
