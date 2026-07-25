export type EntryType = "file" | "dir";

export interface Node {
  id: string;
  name: string;
  parentId: string | null;
  type: EntryType;
  data?: ArrayBuffer;
  size: number;
  createdAt: number;
  modifiedAt: number;
}

export interface Entry extends Node {
  path: string;
}

export interface FileEntry extends Omit<Entry, "type"> {
  type: "file";
  data: ArrayBuffer;
}

export interface DirEntry extends Omit<Entry, "type" | "data"> {
  type: "dir";
}

export interface ListEntry {
  id: string;
  name: string;
  path: string;
  type: EntryType;
  size: number;
  modifiedAt: number;
}

export interface IdbfsOptions {
  dbName?: string;
  dbVersion?: number;
  readOnly?: boolean;
}

export interface DirStats {
  path: string;
  files: number;
  size: number;
  dirs: DirStats[];
}

export type FsEventType = "write" | "delete" | "mkdir" | "rmdir" | "move" | "copy";

export interface FsEvent {
  type: FsEventType;
  path: string;
  oldPath?: string;
}
