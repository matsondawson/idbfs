import { openDB, getById, getChildByName, getChildrenOf, put, del, ROOT_ID } from "./db";
import type { Node, Entry, FileEntry, ListEntry, IdbfsOptions, DirStats, FsEvent } from "./types";

export class Idbfs {
  private db!: IDBDatabase;
  private readonly ready: Promise<void>;
  private readonly _readOnly: boolean;
  private _listeners: Array<{ watchPath: string; cb: (event: FsEvent) => void }> = [];

  constructor(options: IdbfsOptions = {}) {
    const { dbName = "idbfs", dbVersion = 3, readOnly = false } = options;
    this._readOnly = readOnly;
    this.ready = openDB(dbName, dbVersion).then((db) => {
      this.db = db;
      return this._ensureRoot();
    });
  }

  get readOnly(): boolean {
    return this._readOnly;
  }

  async init(): Promise<this> {
    await this.ready;
    return this;
  }

  // ── internal helpers ──────────────────────────────────────────────────────

  private _assertWritable(): void {
    if (this._readOnly) throw new Error("filesystem is read-only");
  }

  private async _ensureRoot(): Promise<void> {
    const root = await getById(this.db, ROOT_ID);
    if (!root) {
      const now = Date.now();
      await put(this.db, { id: ROOT_ID, name: "", parentId: null, type: "dir", size: 0, createdAt: now, modifiedAt: now });
    }
  }

  private normalizePath(path: string, cwd = "/"): string {
    const base = path.startsWith("/") ? path : `${cwd === "/" ? "" : cwd}/${path}`;
    const parts = base.split("/").filter(Boolean);
    const resolved: string[] = [];
    for (const p of parts) {
      if (p === ".") continue;
      if (p === "..") resolved.pop();
      else resolved.push(p);
    }
    return "/" + resolved.join("/");
  }

  private async _resolveNode(absPath: string): Promise<Node | undefined> {
    if (absPath === "/") return getById(this.db, ROOT_ID);
    const parts = absPath.split("/").filter(Boolean);
    let parentId = ROOT_ID;
    let node: Node | undefined;
    for (const part of parts) {
      node = await getChildByName(this.db, parentId, part);
      if (!node) return undefined;
      parentId = node.id;
    }
    return node;
  }

  private async _assertNode(absPath: string): Promise<Node> {
    const node = await this._resolveNode(absPath);
    if (!node) throw new Error(`no such file or directory: ${absPath}`);
    return node;
  }

  private async _getPath(node: Node): Promise<string> {
    if (node.id === ROOT_ID) return "/";
    const parts: string[] = [node.name];
    let parentId = node.parentId!;
    while (parentId !== ROOT_ID) {
      const parent = await getById(this.db, parentId);
      if (!parent) break;
      parts.unshift(parent.name);
      parentId = parent.parentId!;
    }
    return "/" + parts.join("/");
  }

  private _wouldBeInside(srcPath: string, destPath: string): boolean {
    const prefix = srcPath === "/" ? "/" : srcPath + "/";
    return destPath === srcPath || destPath.startsWith(prefix);
  }

  private newId(): string {
    return crypto.randomUUID();
  }

  private _mapChildren(children: Node[], parentPath: string): ListEntry[] {
    const pp = parentPath === "/" ? "" : parentPath;
    return children
      .map((c) => ({ id: c.id, name: c.name, path: `${pp}/${c.name}`, type: c.type, size: c.size, modifiedAt: c.modifiedAt }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }

  private _splitDestPath(absDest: string, fallbackName: string): { newName: string; newParentAbs: string } {
    const parts = absDest.split("/").filter(Boolean);
    return {
      newName: parts.at(-1) ?? fallbackName,
      newParentAbs: parts.length > 1 ? "/" + parts.slice(0, -1).join("/") : "/",
    };
  }

  private _isUnder(path: string, watchPath: string): boolean {
    if (watchPath === "/") return true;
    return path === watchPath || path.startsWith(watchPath + "/");
  }

  private _emit(event: FsEvent): void {
    for (const { watchPath, cb } of this._listeners) {
      if (this._isUnder(event.path, watchPath) || (event.oldPath && this._isUnder(event.oldPath, watchPath))) {
        try { cb(event); } catch { /* listener errors are isolated */ }
      }
    }
  }

  private async _cpFileNode(src: Node, destParentId: string, name: string): Promise<void> {
    const existing = await getChildByName(this.db, destParentId, name);
    const now = Date.now();
    await put(this.db, {
      ...src,
      id: existing?.id ?? this.newId(),
      name,
      parentId: destParentId,
      data: src.data?.slice(0),
      createdAt: existing?.createdAt ?? now,
      modifiedAt: now,
    });
  }

  // ── public API ────────────────────────────────────────────────────────────

  listen(directoryPath: string, callback: (event: FsEvent) => void): () => void {
    const entry = { watchPath: this.normalizePath(directoryPath), cb: callback };
    this._listeners.push(entry);
    return () => {
      const idx = this._listeners.indexOf(entry);
      if (idx !== -1) this._listeners.splice(idx, 1);
    };
  }

  async ls(path = "/", cwd = "/"): Promise<ListEntry[]> {
    await this.ready;
    const abs = this.normalizePath(path, cwd);
    const dir = await this._assertNode(abs);
    if (dir.type !== "dir") throw new Error(`not a directory: ${abs}`);
    const children = await getChildrenOf(this.db, dir.id);
    return this._mapChildren(children, abs);
  }

  async mkdir(path: string, cwd = "/"): Promise<void> {
    await this.ready;
    this._assertWritable();
    const abs = this.normalizePath(path, cwd);
    if (abs === "/") return;
    const parts = abs.split("/").filter(Boolean);
    let parentId = ROOT_ID;
    const now = Date.now();
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const existing = await getChildByName(this.db, parentId, part);
      if (!existing) {
        const id = this.newId();
        await put(this.db, { id, name: part, parentId, type: "dir", size: 0, createdAt: now, modifiedAt: now });
        this._emit({ type: "mkdir", path: "/" + parts.slice(0, i + 1).join("/") });
        parentId = id;
      } else if (existing.type !== "dir") {
        throw new Error(`not a directory: ${existing.name}`);
      } else {
        parentId = existing.id;
      }
    }
  }

  async rmdir(path: string, cwd = "/"): Promise<void> {
    await this.ready;
    this._assertWritable();
    const abs = this.normalizePath(path, cwd);
    if (abs === "/") throw new Error("cannot remove root directory");
    const node = await this._assertNode(abs);
    if (node.type !== "dir") throw new Error(`not a directory: ${abs}`);
    const children = await getChildrenOf(this.db, node.id);
    if (children.length > 0) throw new Error(`directory not empty: ${abs}`);
    await del(this.db, node.id);
    this._emit({ type: "rmdir", path: abs });
  }

  async mv(src: string, dest: string, cwd = "/"): Promise<void> {
    await this.ready;
    this._assertWritable();
    const absSrc = this.normalizePath(src, cwd);
    let absDest = this.normalizePath(dest, cwd);
    const srcNode = await this._assertNode(absSrc);
    const destNode = await this._resolveNode(absDest);
    if (destNode?.type === "dir") {
      absDest = absDest === "/" ? `/${srcNode.name}` : `${absDest}/${srcNode.name}`;
    }
    if (absSrc === absDest) return;
    const { newName, newParentAbs } = this._splitDestPath(absDest, srcNode.name);
    await this.mkdir(newParentAbs);
    const newParent = await this._assertNode(newParentAbs);
    await this.mvNode(srcNode.id, newParent.id, newName);
  }

  async cp(src: string, dest: string, cwd = "/"): Promise<void> {
    await this.ready;
    this._assertWritable();
    const absSrc = this.normalizePath(src, cwd);
    let absDest = this.normalizePath(dest, cwd);
    const srcNode = await this._assertNode(absSrc);
    const destNode = await this._resolveNode(absDest);
    if (destNode?.type === "dir") {
      absDest = absDest === "/" ? `/${srcNode.name}` : `${absDest}/${srcNode.name}`;
    }
    if (absSrc === absDest) throw new Error(`source and destination are the same: ${absSrc}`);
    if (srcNode.type === "dir" && this._wouldBeInside(absSrc, absDest)) {
      throw new Error(`cannot copy directory into itself: ${absDest}`);
    }
    const finalDest = await this._resolveNode(absDest);
    const { newName, newParentAbs } = this._splitDestPath(absDest, srcNode.name);
    await this.mkdir(newParentAbs);
    const newParent = await this._assertNode(newParentAbs);
    if (srcNode.type === "dir") {
      if (finalDest) throw new Error(`already exists: ${absDest}`);
      await this._cpDir(srcNode, newName, newParent.id);
    } else {
      if (finalDest?.type === "file") throw new Error(`file already exists: ${absDest}`);
      const now = Date.now();
      await put(this.db, { ...srcNode, id: this.newId(), name: newName, parentId: newParent.id, data: srcNode.data?.slice(0), createdAt: now, modifiedAt: now });
    }
    this._emit({ type: "copy", path: absDest, oldPath: absSrc });
  }

  private async _cpDir(src: Node, newName: string, newParentId: string): Promise<void> {
    const existing = await getChildByName(this.db, newParentId, newName);
    const id = existing?.id ?? this.newId();
    const now = Date.now();
    await put(this.db, { id, name: newName, parentId: newParentId, type: "dir", size: 0, createdAt: existing?.createdAt ?? now, modifiedAt: now });
    const children = await getChildrenOf(this.db, src.id);
    for (const child of children) {
      if (child.type === "dir") await this._cpDir(child, child.name, id);
      else await this._cpFileNode(child, id, child.name);
    }
  }

  async rm(path: string, cwd = "/"): Promise<void> {
    await this.ready;
    this._assertWritable();
    const abs = this.normalizePath(path, cwd);
    const node = await this._assertNode(abs);
    if (node.type !== "file") throw new Error(`is a directory: ${abs}`);
    await del(this.db, node.id);
    this._emit({ type: "delete", path: abs });
  }

  async writeFile(path: string, data: ArrayBuffer | string, cwd = "/"): Promise<void> {
    await this.ready;
    this._assertWritable();
    const abs = this.normalizePath(path, cwd);
    const parts = abs.split("/").filter(Boolean);
    const name = parts.at(-1)!;
    const parentAbs = parts.length > 1 ? "/" + parts.slice(0, -1).join("/") : "/";
    await this.mkdir(parentAbs);
    const parent = await this._assertNode(parentAbs);
    const buf = typeof data === "string" ? new TextEncoder().encode(data).buffer as ArrayBuffer : data;
    const existing = await getChildByName(this.db, parent.id, name);
    const now = Date.now();
    await put(this.db, { id: existing?.id ?? this.newId(), name, parentId: parent.id, type: "file", data: buf, size: buf.byteLength, createdAt: existing?.createdAt ?? now, modifiedAt: now });
    this._emit({ type: "write", path: abs });
  }

  async readFile(path: string, cwd = "/"): Promise<FileEntry> {
    await this.ready;
    const abs = this.normalizePath(path, cwd);
    const node = await this._assertNode(abs);
    if (node.type !== "file") throw new Error(`is a directory: ${abs}`);
    return { ...node, type: "file", data: node.data!, path: abs };
  }

  async exists(path: string, cwd = "/"): Promise<boolean> {
    await this.ready;
    const abs = this.normalizePath(path, cwd);
    return !!(await this._resolveNode(abs));
  }

  async stat(path: string, cwd = "/"): Promise<Omit<Entry, "data">> {
    await this.ready;
    const abs = this.normalizePath(path, cwd);
    const node = await this._assertNode(abs);
    const { data: _data, ...rest } = node;
    return { ...rest, path: abs };
  }

  async du(path = "/", cwd = "/"): Promise<DirStats> {
    await this.ready;
    const abs = this.normalizePath(path, cwd);
    const node = await this._assertNode(abs);
    return this._du(node, abs);
  }

  private async _du(node: Node, path: string): Promise<DirStats> {
    const children = await getChildrenOf(this.db, node.id);
    const stats: DirStats = { path, files: 0, size: 0, dirs: [] };
    const parentPath = path === "/" ? "" : path;
    for (const child of children) {
      const childPath = `${parentPath}/${child.name}`;
      if (child.type === "file") {
        stats.files++;
        stats.size += child.size;
      } else {
        const sub = await this._du(child, childPath);
        stats.files += sub.files;
        stats.size += sub.size;
        stats.dirs.push(sub);
      }
    }
    return stats;
  }

  // ── node-ID based API ─────────────────────────────────────────────────────

  async lsById(nodeId: string): Promise<ListEntry[]> {
    await this.ready;
    const dir = await getById(this.db, nodeId);
    if (!dir) throw new Error(`no such node: ${nodeId}`);
    if (dir.type !== "dir") throw new Error(`not a directory`);
    const parentPath = await this._getPath(dir);
    const children = await getChildrenOf(this.db, nodeId);
    return this._mapChildren(children, parentPath);
  }

  async renameNode(nodeId: string, newName: string): Promise<void> {
    await this.ready;
    this._assertWritable();
    const node = await getById(this.db, nodeId);
    if (!node) throw new Error(`no such node`);
    if (!newName.trim()) throw new Error(`name cannot be empty`);
    const oldPath = await this._getPath(node);
    const parent = node.parentId ? await getById(this.db, node.parentId) : null;
    const parentPath = parent ? await this._getPath(parent) : "/";
    const newPath = parentPath === "/" ? `/${newName}` : `${parentPath}/${newName}`;
    await put(this.db, { ...node, name: newName, modifiedAt: Date.now() });
    this._emit({ type: "move", path: newPath, oldPath });
  }

  async mkdirUnder(parentId: string, name: string): Promise<void> {
    await this.ready;
    this._assertWritable();
    const parent = await getById(this.db, parentId);
    if (!parent || parent.type !== "dir") throw new Error(`not a directory`);
    const existing = await getChildByName(this.db, parentId, name);
    if (existing) throw new Error(`already exists: ${name}`);
    const parentPath = await this._getPath(parent);
    const now = Date.now();
    await put(this.db, { id: this.newId(), name, parentId, type: "dir", size: 0, createdAt: now, modifiedAt: now });
    this._emit({ type: "mkdir", path: parentPath === "/" ? `/${name}` : `${parentPath}/${name}` });
  }

  async rmById(nodeId: string): Promise<void> {
    await this.ready;
    this._assertWritable();
    const node = await getById(this.db, nodeId);
    if (!node) throw new Error(`no such node`);
    if (node.type !== "file") throw new Error(`is a directory`);
    const path = await this._getPath(node);
    await del(this.db, nodeId);
    this._emit({ type: "delete", path });
  }

  async rmDirById(nodeId: string): Promise<void> {
    await this.ready;
    this._assertWritable();
    if (nodeId === ROOT_ID) throw new Error(`cannot remove root`);
    const node = await getById(this.db, nodeId);
    if (!node) throw new Error(`no such node`);
    if (node.type !== "dir") throw new Error(`not a directory`);
    const children = await getChildrenOf(this.db, nodeId);
    if (children.length > 0) throw new Error(`directory not empty`);
    const path = await this._getPath(node);
    await del(this.db, nodeId);
    this._emit({ type: "rmdir", path });
  }

  async mvNode(srcId: string, destParentId: string, newName?: string): Promise<void> {
    await this.ready;
    this._assertWritable();
    const src = await getById(this.db, srcId);
    if (!src) throw new Error(`no such node`);
    const destParent = await getById(this.db, destParentId);
    if (!destParent || destParent.type !== "dir") throw new Error(`not a directory`);
    if (src.type === "dir") {
      let cur: string | null = destParentId;
      while (cur) {
        if (cur === srcId) throw new Error(`cannot move directory into itself`);
        cur = (await getById(this.db, cur))?.parentId ?? null;
      }
    }
    const oldPath = await this._getPath(src);
    const destParentPath = await this._getPath(destParent);
    const name = newName ?? src.name;
    const newPath = destParentPath === "/" ? `/${name}` : `${destParentPath}/${name}`;
    const conflict = await getChildByName(this.db, destParentId, name);
    if (conflict && conflict.id !== srcId && conflict.type === "file") {
      await del(this.db, conflict.id);
    }
    await put(this.db, { ...src, name, parentId: destParentId, modifiedAt: Date.now() });
    this._emit({ type: "move", path: newPath, oldPath });
  }

  async cpNode(srcId: string, destParentId: string, newName?: string): Promise<void> {
    await this.ready;
    this._assertWritable();
    const src = await getById(this.db, srcId);
    if (!src) throw new Error(`no such node`);
    const destParent = await getById(this.db, destParentId);
    if (!destParent) throw new Error(`no such node`);
    const oldPath = await this._getPath(src);
    const destParentPath = await this._getPath(destParent);
    const name = newName ?? src.name;
    const newPath = destParentPath === "/" ? `/${name}` : `${destParentPath}/${name}`;
    if (src.type === "dir") {
      let cur: string | null = destParentId;
      while (cur) {
        if (cur === srcId) throw new Error(`cannot copy directory into itself`);
        cur = (await getById(this.db, cur))?.parentId ?? null;
      }
      await this._cpDir(src, name, destParentId);
    } else {
      await this._cpFileNode(src, destParentId, name);
    }
    this._emit({ type: "copy", path: newPath, oldPath });
  }

  private _triggerDownload(name: string, data: ArrayBuffer): void {
    const url = URL.createObjectURL(new Blob([data]));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private async _collectFiles(abs: string): Promise<Array<{ name: string; data: ArrayBuffer }>> {
    const node = await this._assertNode(abs);
    if (node.type === "file") return [{ name: node.name, data: node.data! }];
    const children = await getChildrenOf(this.db, node.id);
    const results: Array<{ name: string; data: ArrayBuffer }> = [];
    for (const child of children) {
      const childAbs = abs === "/" ? `/${child.name}` : `${abs}/${child.name}`;
      results.push(...(await this._collectFiles(childAbs)));
    }
    return results;
  }

  async downloadFile(path: string, cwd = "/"): Promise<void> {
    await this.ready;
    const file = await this.readFile(path, cwd);
    this._triggerDownload(file.name, file.data);
  }

  async downloadDir(path = "/", cwd = "/"): Promise<void> {
    await this.ready;
    const abs = this.normalizePath(path, cwd);
    const files = await this._collectFiles(abs);
    for (const file of files) {
      this._triggerDownload(file.name, file.data);
    }
  }

  resolve(path: string, cwd = "/"): string {
    return this.normalizePath(path, cwd);
  }
}

export async function connectIdbfs(options?: IdbfsOptions): Promise<Idbfs> {
  return new Idbfs(options).init();
}
