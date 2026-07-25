# idbfs

A browser filesystem backed by IndexedDB. Licensed under MIT.

![idbfs terminal and file tree example](docs/app-example.png)

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

<FileTree fs={fs} refreshKey={n} cwd={cwd} onUploaded={(names) => console.log(names)} />
```

- Expand/collapse directories via the `▶`/`▼` chevron
- Click a file to preview (image, audio, or text) in the panel below the tree
- Double-click any node to rename inline
- Right-click for context menu: New folder (dirs), Paste (dirs, when the clipboard has entries), Copy, Rename, Download (when files are selected), Delete
- Drag a node onto a directory to move it
- Drag files from the OS onto the tree, or paste an image, to upload into `cwd` — reported via `onUploaded`
- `refreshKey` — increment after any filesystem mutation to reload expanded directories
- `toolbar` — optional `ReactNode` rendered above the tree
- `renderContextMenuExtra(entry, close)` — inject extra context-menu items (used by GitHub sync's per-folder actions)

OS file drop and clipboard image paste are built in — both `FileTree` and `Terminal` accept an `onUploaded?: (names: string[]) => void` prop and handle drag/paste internally.

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

## GitHub sync

This repo's demo app (`src/App.tsx`) can sync any folder against a real GitHub repository — push, pull, branches, `.gitignore` filtering, via `gh` commands in the terminal or a right-click menu on the tree. The implementation lives in `src/github/` and its code isn't bundled into the published `@octalgia/idbfs` dist (the lib build entry is `src/lib/index.ts`, which never imports it) — but `@octokit/rest` and `ignore` are still regular `dependencies` in `package.json`, so every install of the package pulls them in. Every hook the sync code uses is public library API: `runCommand`'s `extra` param is what wires `gh` commands into `Terminal`, and `FileTree`'s `toolbar`/`renderContextMenuExtra` props are what add the sign-in button and per-folder menu. Any consumer of the library — whether using `Terminal`, `FileTree`, or the raw `Idbfs` API directly — can wire up the same sync behavior in their own app.

Sync is per-directory, like `.git`: any folder can point at a different repo by having its own `.github/idbfs-sync.json`, found by walking up from the current directory the same way git finds `.git/`. A nested folder with its own config is treated as an independent repo boundary — its content is never folded into an ancestor's push.

```
gh auth login <token>     store a github personal access token (fine-grained, Contents: read/write, scoped to one repo)
gh auth logout / status

gh clone <owner>/<repo>|<url> [branch]   create a subfolder named after the repo and pull into it (like `git clone`)
gh init <owner>/<repo> [branch]          sync this directory without pulling (like `git init`)
gh remote                                 show the resolved sync config for the current directory

gh push [--force] [-m msg]                push local state (full snapshot each time)
gh pull [--force <path>|--force-all]      pull remote state
gh status                                 show local/remote changes and conflicts
gh branch [name]                          list branches, or create one
gh checkout <branch>                      switch the active branch (does not auto-pull)
```

The same actions are available by right-clicking a folder in the tree. Auth is the one thing that's global (one token, works across every repo it has access to) — everything else is scoped to whichever folder you're in.

Auth is a Personal Access Token pasted by the user, stored in `localStorage`. There's no backend: GitHub's OAuth endpoints don't send CORS headers for browser `fetch`, so token-exchange flows aren't possible from a pure static app without a relay — a PAT was the pragmatic choice for now. Use a token scoped to just the repo(s) you intend to sync, not a broad classic PAT.

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
