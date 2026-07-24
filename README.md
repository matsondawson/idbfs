# idbfs

A browser filesystem backed by IndexedDB. Licensed under MIT.

---

## Storage model

Each file or directory is a **node** stored as its own IndexedDB record in a store named `filenode`. A node contains only its own name — full paths are computed on demand by walking parent references. The root node has the fixed ID `"root"`.

```
Node {
  id:         string        // UUID, keyPath
  name:       string        // own name only, no slashes
  parentId:   string | null // null = root
  type:       'file' | 'dir'
  data?:      ArrayBuffer   // files only
  size:       number
  createdAt:  number        // ms
  modifiedAt: number        // ms
}
```

The single index is on `parentId`. Path strings are accepted as input to the API and resolved to node IDs by walking the tree segment by segment. The `path` field on returned entries is computed, not stored.

---

## Installation

```sh
npm install
npm run dev
```

---

## API

All exports from `src/lib`:

```ts
import { connectIdbfs, complete, ROOT_ID } from './src/lib';
import type { FileEntry, ListEntry, Entry, DirStats, CompletionResult, FsEvent, FsEventType } from './src/lib';
```

---

### `connectIdbfs(options?)`

```ts
const fs = await connectIdbfs({ dbName: 'myapp' });
```

| Option | Type | Default |
|--------|------|---------|
| `dbName` | `string` | `'idbfs'` |
| `dbVersion` | `number` | `3` |

---

### Path-based API

All path methods accept an optional `cwd` (default `'/'`) for resolving relative paths. Paths support `.` and `..`.

#### `fs.writeFile(path, data, cwd?)`

Write a file. Creates parent directories as needed. Overwrites if the file exists.

```ts
await fs.writeFile('/docs/hello.txt', 'hello world');
await fs.writeFile('/img/photo.png', arrayBuffer);
await fs.writeFile('notes.txt', 'hi', '/docs');
```

#### `fs.readFile(path, cwd?)` → `FileEntry`

```ts
const file = await fs.readFile('/docs/hello.txt');
const text = new TextDecoder().decode(file.data);
```

`FileEntry`: `{ id, name, parentId, path, type:'file', data:ArrayBuffer, size, createdAt, modifiedAt }`

#### `fs.ls(path?, cwd?)` → `ListEntry[]`

Sorted directories-first then alphabetically.

```ts
const entries = await fs.ls('/docs');
```

`ListEntry`: `{ id, name, path, type, size, modifiedAt }`

#### `fs.mkdir(path, cwd?)`

Creates intermediate directories as needed. No-op if already exists.

#### `fs.rm(path, cwd?)`

Remove a file. Throws if it is a directory.

#### `fs.rmdir(path, cwd?)`

Remove an empty directory. Throws if it has contents.

#### `fs.mv(src, dest, cwd?)`

Move or rename a file or directory. If `dest` is an existing directory, source moves into it. Creates parent dirs of `dest` as needed. Moving a directory is O(1) — only its node is updated.

```ts
await fs.mv('draft.txt', 'final.txt');
await fs.mv('photo.png', '/archive');          // → /archive/photo.png
await fs.mv('/old-dir', '/new-dir');
```

#### `fs.cp(src, dest, cwd?)`

Copy a file or directory recursively. Errors if destination already exists or would be inside src.

#### `fs.stat(path, cwd?)` → `Omit<Entry, 'data'>`

Metadata without file data.

#### `fs.exists(path, cwd?)` → `boolean`

#### `fs.resolve(path, cwd?)` → `string`

Normalise a path string without touching the DB.

#### `fs.listen(path, callback)` → `() => void`

Watch a directory for filesystem events. Returns an unsubscribe function.

```ts
const unlisten = fs.listen('/uploads', (event: FsEvent) => {
  console.log(event.type, event.path, event.oldPath);
});

await fs.writeFile('/uploads/photo.jpg', buf);
// → { type: 'write', path: '/uploads/photo.jpg' }

await fs.mv('/uploads/photo.jpg', '/archive/');
// → { type: 'move', path: '/archive/photo.jpg', oldPath: '/uploads/photo.jpg' }

unlisten(); // stop watching
```

`FsEvent`: `{ type: FsEventType, path: string, oldPath?: string }`

| `FsEventType` | Trigger |
|---|---|
| `write` | `writeFile` — file created or overwritten |
| `delete` | `rm`, `rmById` — file deleted |
| `mkdir` | `mkdir`, `mkdirUnder` — directory created (one event per new segment) |
| `rmdir` | `rmdir`, `rmDirById` — directory deleted |
| `move` | `mv`, `mvNode`, `renameNode` — node moved or renamed; `oldPath` is the previous path |
| `copy` | `cp`, `cpNode` — node copied; `oldPath` is the source path |

Listening on `'/'` receives all events. Listeners match the watched path itself and any path beneath it. Listener errors are caught and isolated.

---

#### `fs.downloadFile(path, cwd?)`

Trigger a browser download for a single file.

```ts
await fs.downloadFile('/docs/hello.txt');
```

#### `fs.downloadDir(path?, cwd?)`

Trigger a browser download for every file in a directory (recursively). One download per file — no zip. Browsers may prompt to allow multiple downloads for the site.

```ts
await fs.downloadDir('/uploads');
await fs.downloadDir(); // entire filesystem
```

---

#### `fs.du(path?, cwd?)` → `DirStats`

Recursive file count and size.

```ts
const { files, size, dirs } = await fs.du('/docs');
```

`DirStats`: `{ path, files, size, dirs: DirStats[] }`

#### `fs.dump()` → `Entry[]`

All nodes with computed paths. Useful for debugging or export.

---

### Node-ID-based API

Use these when you already have a node ID (e.g. from the file tree). No path resolution overhead.

| Method | Description |
|--------|-------------|
| `fs.lsById(nodeId)` | List children of a directory node |
| `fs.renameNode(nodeId, newName)` | Rename a node in place |
| `fs.mkdirUnder(parentId, name)` | Create a directory under a parent node |
| `fs.rmById(nodeId)` | Delete a file node |
| `fs.rmDirById(nodeId)` | Delete an empty directory node |
| `fs.mvNode(srcId, destParentId, newName?)` | Move a node to a new parent |
| `fs.cpNode(srcId, destParentId, newName?)` | Copy a node to a new parent |

`ROOT_ID` is the fixed string ID of the root node (`"root"`).

---

### `complete(input, cwd, fs)` → `CompletionResult`

Tab completion for terminal UIs. Completes command names on the first token, filesystem entries on subsequent tokens and on paths starting with `/`, `./`, or `..`.

```ts
const result = await complete('ls doc', '/', fs);
result.value;      // 'ls docs/'  — replacement string (null if ambiguous)
result.candidates; // ['docs']    — all matches
```

---

## React components

### `FileTree`

```tsx
import { FileTree } from './src/ui/FileTree';

<FileTree fs={fs} refreshKey={n} onNavigate={(path) => setCwd(path)} />
```

- Expand/collapse directories via the `▶`/`▼` chevron
- Click a file to preview (image, audio, or text) in the panel below the tree
- Double-click any node to rename inline
- Right-click for context menu: Open in terminal, New folder, Copy, Delete
- Drag a node onto a directory to move it
- `refreshKey` — increment after any filesystem mutation to reload expanded directories

### `DragDrop`

Wraps content with OS file drop and clipboard paste (images) support. Uploads to the current `cwd`.

```tsx
import { DragDrop } from './src/ui/DragDrop';

<DragDrop fs={fs} cwd={cwd} onUploaded={(names) => console.log(names)}>
  {children}
</DragDrop>
```

---

## Terminal commands

| Command | Description |
|---------|-------------|
| `ls [path]` | List directory |
| `cd [path]` | Change directory (persisted across reloads) |
| `mkdir <path>` | Create directory |
| `rm <file>` | Remove file |
| `rmdir <dir>` | Remove empty directory |
| `mv <src> <dst>` | Move or rename file or directory |
| `cp <src> <dst>` | Copy file or directory |
| `du [path]` | Show disk usage recursively |
| `view <file>` | Display image, play audio, or show text |
| `./file` or `/path` | Shorthand for `view` |
| `stat <path>` | Show file metadata |
| `pwd` | Print working directory |
| `clear` | Clear terminal |
| `help` | List commands |

Tab completes commands and paths (including `./` and `../`). Arrow keys navigate history. Ctrl+U clears the input. Click anywhere to focus the prompt.

Upload: drag and drop files onto the window, or paste an image with Ctrl+V.

---

## Development

```sh
npm run dev        # start dev server
npm run build      # production build
npm run test       # run tests
npm run lint       # oxlint
npm run fmt        # format with oxfmt
npm run fmt:check  # check formatting (CI)
```
