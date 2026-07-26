import { useState, useCallback, useEffect, useRef } from "react";
import type { Idbfs, ListEntry, IgnoreMatcher } from "../lib";
import { ROOT_ID, mimeFromName, buildIgnoreMatcher } from "../lib";
import { fileIconColor } from "./icons";
import { useFileDrop, DropOverlay } from "./useFileDrop.tsx";
import { GhAuthButton } from "../github/GhAuthButton";
import { GhActivityIndicator } from "../github/GhActivityIndicator";
import { GhContextMenuItems } from "../github/GhContextMenu";
import "./FileTree.css";

export type Feature = "github";

interface Props {
  fs: Idbfs;
  refreshKey: number;
  cwd?: string;
  onUploaded?: (names: string[]) => void;
  theme?: "light" | "dark";
  features?: Feature[];
  /** Extra toolbar content, rendered after any feature-provided controls. */
  toolbar?: React.ReactNode;
  /** Extra context-menu items, rendered after any feature-provided items. */
  renderContextMenuExtra?: (entry: ListEntry, close: () => void) => React.ReactNode;
}

interface ContextMenu {
  x: number;
  y: number;
  entry: ListEntry;
}

interface Preview {
  name: string;
  mime: string;
  url?: string;
  text?: string;
}

export function FileTree({
  fs,
  refreshKey,
  cwd = "/",
  onUploaded,
  theme = "dark",
  features = ["github"],
  toolbar = "Files:",
  renderContextMenuExtra,
}: Props) {
  const readOnly = fs.readOnly;
  const hasGithub = features.includes("github");
  const [childMap, setChildMap] = useState<Map<string, ListEntry[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set([ROOT_ID]));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [newFolderParentId, setNewFolderParentId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [clipboard, setClipboard] = useState<ListEntry[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [showIgnored, setShowIgnored] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [ignoreMatcher, setIgnoreMatcher] = useState<IgnoreMatcher | null>(null);
  // bumped by feature-provided actions (e.g. github pull) that change files
  // without the host app knowing, so the tree can refresh itself
  const [internalRefresh, setInternalRefresh] = useState(0);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const dragSourceIds = useRef<Set<string>>(new Set());
  const lastClickedId = useRef<string | null>(null);
  const previewUrl = useRef<string | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const newFolderRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const clipboardMarker = useRef<string | null>(null);

  const loadDir = useCallback(
    async (nodeId: string) => {
      try {
        const entries = await fs.lsById(nodeId);
        setChildMap((prev) => new Map(prev).set(nodeId, entries));
      } catch {
        // node deleted or inaccessible
      }
    },
    [fs],
  );

  useEffect(() => {
    void loadDir(ROOT_ID);
  }, [fs, loadDir]);

  const uploadCwd = cwd;

  const handleUploaded = useCallback(
    async (names: string[]) => {
      await loadDir(ROOT_ID);
      onUploaded?.(names);
    },
    [loadDir, onUploaded],
  );

  const {
    externalDrag,
    onDragOver,
    onDragLeave,
    onDrop: onExternalDrop,
    clearDrag,
  } = useFileDrop(fs, uploadCwd, handleUploaded);

  useEffect(() => {
    setExpanded((prev) => {
      prev.forEach((id) => loadDir(id));
      return prev;
    });
  }, [refreshKey, internalRefresh, loadDir]);

  useEffect(() => {
    void loadDir(ROOT_ID);
  }, [loadDir]);

  useEffect(() => {
    if (showIgnored) {
      setIgnoreMatcher(null);
      return;
    }
    let cancelled = false;
    buildIgnoreMatcher(fs, "/").then((matcher) => {
      if (!cancelled) setIgnoreMatcher(() => matcher);
    });
    return () => {
      cancelled = true;
    };
  }, [fs, refreshKey, internalRefresh, showIgnored]);

  useEffect(() => {
    if (!filterMenuOpen) return;
    const dismiss = (e: MouseEvent) => {
      if (!filterMenuRef.current?.contains(e.target as Node)) setFilterMenuOpen(false);
    };
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [filterMenuOpen]);

  useEffect(() => {
    if (renamingId && renameRef.current) renameRef.current.focus();
  }, [renamingId]);

  useEffect(() => {
    if (newFolderParentId && newFolderRef.current) newFolderRef.current.focus();
  }, [newFolderParentId]);

  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      if (!treeRef.current?.contains(e.target as Node)) {
        setClipboard([]);
        clipboardMarker.current = null;
      }
    };
    document.addEventListener("copy", handler);
    return () => document.removeEventListener("copy", handler);
  }, []);

  useEffect(() => {
    const handler = async () => {
      if (clipboardMarker.current === null) return;
      try {
        const text = await navigator.clipboard.readText();
        if (text !== clipboardMarker.current) {
          setClipboard([]);
          clipboardMarker.current = null;
        }
      } catch {
        // clipboard API unavailable — leave internal clipboard intact
      }
    };
    window.addEventListener("focus", handler);
    return () => window.removeEventListener("focus", handler);
  }, []);

  useEffect(() => {
    const el = popoverRef.current;
    if (!el) return;
    if (contextMenu) {
      if (!el.matches(":popover-open")) el.showPopover();
      const id = setTimeout(() => {
        const dismiss = (e: MouseEvent) => {
          if (!el.contains(e.target as Node)) {
            setContextMenu(null);
            document.removeEventListener("mousedown", dismiss);
          }
        };
        document.addEventListener("mousedown", dismiss);
        return () => document.removeEventListener("mousedown", dismiss);
      }, 0);
      return () => clearTimeout(id);
    } else {
      if (el.matches(":popover-open")) el.hidePopover();
    }
  }, [contextMenu]);

  const isVisible = useCallback(
    (entry: ListEntry) => {
      if (!showHidden && entry.name.startsWith(".")) return false;
      if (!showIgnored && ignoreMatcher?.(entry.path.slice(1), entry.type === "dir")) return false;
      return true;
    },
    [showHidden, showIgnored, ignoreMatcher],
  );

  const toggle = useCallback(
    (nodeId: string) => {
      if (nodeId === ROOT_ID) return;
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(nodeId)) {
          next.delete(nodeId);
        } else {
          next.add(nodeId);
          loadDir(nodeId);
        }
        return next;
      });
    },
    [loadDir],
  );

  const loadPreview = useCallback(
    async (entry: ListEntry) => {
      if (previewUrl.current) {
        URL.revokeObjectURL(previewUrl.current);
        previewUrl.current = null;
      }
      try {
        const file = await fs.readFile(entry.path);
        const mime = mimeFromName(file.name);
        if (mime.startsWith("image/") || mime.startsWith("audio/")) {
          const blob = new Blob([file.data], { type: mime });
          const url = URL.createObjectURL(blob);
          previewUrl.current = url;
          setPreview({ name: file.name, mime, url });
        } else if (mime.startsWith("text/") || mime === "application/json") {
          const text = new TextDecoder().decode(file.data);
          setPreview({ name: file.name, mime, text: text.slice(0, 600) });
        } else {
          setPreview({ name: file.name, mime });
        }
      } catch {
        setPreview(null);
      }
    },
    [fs],
  );

  const handleNodeClick = useCallback(
    (e: React.MouseEvent, entry: ListEntry) => {
      treeRef.current?.focus({ preventScroll: true });
      if (e.shiftKey && lastClickedId.current) {
        const flat = flatIds(childMap, expanded, isVisible);
        const a = flat.indexOf(lastClickedId.current);
        const b = flat.indexOf(entry.id);
        if (a !== -1 && b !== -1) {
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          setSelectedIds(new Set(flat.slice(lo, hi + 1)));
          setPreview(null);
        }
      } else if (e.ctrlKey || e.metaKey) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(entry.id)) next.delete(entry.id);
          else next.add(entry.id);
          return next;
        });
        lastClickedId.current = entry.id;
        setPreview(null);
      } else {
        setSelectedIds(new Set([entry.id]));
        lastClickedId.current = entry.id;
        if (entry.type === "file") void loadPreview(entry);
        else setPreview(null);
      }
    },
    [childMap, expanded, loadPreview, isVisible],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: ListEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedIds((prev) => {
      if (prev.has(entry.id)) return prev;
      lastClickedId.current = entry.id;
      return new Set([entry.id]);
    });
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  const commitRename = useCallback(
    async (entry: ListEntry) => {
      const name = renameValue.trim();
      setRenamingId(null);
      if (!name || name === entry.name) return;
      try {
        await fs.renameNode(entry.id, name);
        const parentId = findParentId(childMap, entry.id) ?? ROOT_ID;
        await loadDir(parentId);
      } catch (err) {
        console.error(err);
      }
    },
    [fs, renameValue, loadDir, childMap],
  );

  const handleDelete = useCallback(async () => {
    setContextMenu(null);
    const allEntries = [...childMap.values()].flat();
    const toDelete = allEntries.filter((e) => selectedIds.has(e.id));
    const affectedParents = new Set<string>();
    for (const entry of toDelete) {
      const parentId = findParentId(childMap, entry.id);
      if (parentId) affectedParents.add(parentId);
      try {
        if (entry.type === "file") await fs.rmById(entry.id);
        else await deleteDirById(fs, entry.id);
      } catch (err) {
        console.error(err);
      }
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      toDelete.forEach((e) => next.delete(e.id));
      return next;
    });
    setPreview(null);
    for (const pid of affectedParents) await loadDir(pid);
  }, [fs, loadDir, childMap, selectedIds]);

  const handleDownload = useCallback(async () => {
    setContextMenu(null);
    const allEntries = [...childMap.values()].flat();
    const toDownload = allEntries.filter((e) => selectedIds.has(e.id) && e.type === "file");
    for (const entry of toDownload) {
      try {
        const file = await fs.readFile(entry.path);
        const blob = new Blob([file.data]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = entry.name;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error(err);
      }
    }
  }, [fs, selectedIds, childMap]);

  const handleCopyToClipboard = useCallback(() => {
    setContextMenu(null);
    const allEntries = [...childMap.values()].flat();
    setClipboard(allEntries.filter((e) => selectedIds.has(e.id)));
    const marker = `idbfs:${crypto.randomUUID()}`;
    clipboardMarker.current = marker;
    navigator.clipboard.writeText(marker).catch(() => {
      clipboardMarker.current = null;
    });
  }, [selectedIds, childMap]);

  const handlePasteText = useCallback(
    async (text: string) => {
      const allEntries = [...childMap.values()].flat();
      const selectedDir = allEntries.find((e) => selectedIds.has(e.id) && e.type === "dir");
      const selectedEntry = allEntries.find((e) => selectedIds.has(e.id));

      const targetPath =
        selectedDir?.path ??
        (selectedEntry
          ? selectedEntry.path.substring(0, selectedEntry.path.lastIndexOf("/")) || "/"
          : null) ??
        uploadCwd;
      const targetId =
        selectedDir?.id ??
        (selectedEntry ? (findParentId(childMap, selectedEntry.id) ?? ROOT_ID) : null) ??
        ROOT_ID;

      const fileName = "untitled.txt";
      try {
        await fs.writeFile(fileName, text, targetPath);
        await loadDir(targetId);
        setExpanded((prev) => new Set(prev).add(targetId));
        const fresh = await fs.lsById(targetId);
        const newEntry = fresh.find((e) => e.name === fileName);
        if (newEntry) {
          setSelectedIds(new Set([newEntry.id]));
          lastClickedId.current = newEntry.id;
          setRenamingId(newEntry.id);
          setRenameValue(fileName);
        }
      } catch (err) {
        console.error(err);
      }
    },
    [fs, loadDir, childMap, selectedIds, uploadCwd],
  );

  const handlePasteImages = useCallback(
    async (e: React.ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItems = items.filter((i) => i.type.startsWith("image/"));
      if (imageItems.length === 0) return;
      e.preventDefault();
      const allEntries = [...childMap.values()].flat();
      const selectedDir = allEntries.find((en) => selectedIds.has(en.id) && en.type === "dir");
      const selectedEntry = allEntries.find((en) => selectedIds.has(en.id));
      const targetPath =
        selectedDir?.path ??
        (selectedEntry
          ? selectedEntry.path.substring(0, selectedEntry.path.lastIndexOf("/")) || "/"
          : null) ??
        uploadCwd;
      const targetId =
        selectedDir?.id ??
        (selectedEntry ? (findParentId(childMap, selectedEntry.id) ?? ROOT_ID) : null) ??
        ROOT_ID;
      const uploaded: string[] = [];
      for (const item of imageItems) {
        const file = item.getAsFile();
        if (!file) continue;
        const ext = item.type.split("/")[1] ?? "png";
        const name = `paste-${Date.now()}.${ext}`;
        await fs.writeFile(name, await file.arrayBuffer(), targetPath);
        uploaded.push(name);
      }
      await loadDir(targetId);
      setExpanded((prev) => new Set(prev).add(targetId));
      onUploaded?.(uploaded);
    },
    [fs, loadDir, childMap, selectedIds, uploadCwd, onUploaded],
  );

  const handlePaste = useCallback(
    async (destEntry: ListEntry) => {
      setContextMenu(null);
      if (clipboard.length === 0) return;
      const destId =
        destEntry.type === "dir" ? destEntry.id : (findParentId(childMap, destEntry.id) ?? ROOT_ID);
      for (const entry of clipboard) {
        try {
          await fs.cpNode(entry.id, destId);
        } catch (err) {
          console.error(err);
        }
      }
      await loadDir(destId);
      setExpanded((prev) => new Set(prev).add(destId));
    },
    [fs, clipboard, loadDir, childMap],
  );

  const handleNewFolder = useCallback(
    (nodeId: string) => {
      setContextMenu(null);
      setNewFolderParentId(nodeId);
      setNewFolderName("");
      if (!expanded.has(nodeId)) toggle(nodeId);
    },
    [expanded, toggle],
  );

  const commitNewFolder = useCallback(
    async (parentId: string) => {
      const name = newFolderName.trim();
      setNewFolderParentId(null);
      if (!name) return;
      try {
        await fs.mkdirUnder(parentId, name);
        await loadDir(parentId);
      } catch (err) {
        console.error(err);
      }
    },
    [fs, newFolderName, loadDir],
  );

  const handleDrop = useCallback(
    async (destId: string) => {
      const srcIds = [...dragSourceIds.current];
      dragSourceIds.current = new Set();
      setDragOverId(null);
      if (srcIds.length === 0) return;
      const affectedParents = new Set<string>();
      for (const srcId of srcIds) {
        if (srcId === destId) continue;
        const parentId = findParentId(childMap, srcId) ?? ROOT_ID;
        affectedParents.add(parentId);
        try {
          await fs.mvNode(srcId, destId);
        } catch (err) {
          console.error(err);
        }
      }
      affectedParents.add(destId);
      for (const pid of affectedParents) await loadDir(pid);
      setExpanded((prev) => new Set(prev).add(destId));
    },
    [fs, loadDir, childMap],
  );

  const handleExternalDropToFolder = useCallback(
    async (e: React.DragEvent, entry: ListEntry) => {
      setDragOverId(null);
      clearDrag();
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      const uploaded: string[] = [];
      for (const file of files) {
        await fs.writeFile(file.name, await file.arrayBuffer(), entry.path);
        uploaded.push(file.name);
      }
      await loadDir(entry.id);
      setExpanded((prev) => new Set(prev).add(entry.id));
      onUploaded?.(uploaded);
    },
    [fs, loadDir, onUploaded, clearDrag],
  );

  const DOT_ENTRY: ListEntry = {
    id: ROOT_ID,
    name: ".",
    type: "dir",
    path: "/",
    size: 0,
    modifiedAt: 0,
  };

  function renderNode(entry: ListEntry, depth: number): React.ReactNode {
    const { path: icon, color } = fileIconColor(entry.name, entry.type);
    const isRoot = entry.id === ROOT_ID;
    const isDir = entry.type === "dir";
    const isExpanded = expanded.has(entry.id);
    const isSelected = selectedIds.has(entry.id);
    const isDragOver = dragOverId === entry.id;
    const isRenaming = renamingId === entry.id;
    const children = childMap.get(entry.id)?.filter(isVisible);

    return (
      <div key={entry.id}>
        <div
          draggable={!isRoot && !readOnly}
          onDragStart={(e) => {
            if (readOnly) return;
            const ids = selectedIds.has(entry.id) ? new Set(selectedIds) : new Set([entry.id]);
            if (!selectedIds.has(entry.id)) {
              setSelectedIds(ids);
              lastClickedId.current = entry.id;
            }
            dragSourceIds.current = ids;
            e.dataTransfer.setData("application/idbfs-nodes", JSON.stringify([...ids]));
            e.stopPropagation();
          }}
          onDragOver={(e) => {
            if (!isDir || readOnly) return;
            if (
              e.dataTransfer.types.includes("application/idbfs-nodes") ||
              e.dataTransfer.types.includes("Files")
            ) {
              e.preventDefault();
              e.stopPropagation();
              setDragOverId(entry.id);
            }
          }}
          onDragLeave={() => setDragOverId(null)}
          onDrop={(e) => {
            if (readOnly) return;
            if (isDir && e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              e.stopPropagation();
              void handleExternalDropToFolder(e, entry);
            } else if (e.dataTransfer.types.includes("application/idbfs-nodes")) {
              e.preventDefault();
              e.stopPropagation();
              void handleDrop(entry.id);
            }
          }}
          onContextMenu={(e) => handleContextMenu(e, entry)}
          onClick={(e) => {
            e.stopPropagation();
            handleNodeClick(e, entry);
          }}
          className={[
            "idbfs-tree__node-row",
            isDragOver ? "idbfs-tree__node-row--dragover" : "",
            isSelected ? "idbfs-tree__node-row--selected" : "",
          ].join(" ")}
          style={{ paddingLeft: `${depth * 16 + 4}px` }}
        >
          <span
            className={`idbfs-tree__chevron${isDir ? " idbfs-tree__chevron--dir" : ""}`}
            onClick={(e) => {
              if (isDir) {
                e.stopPropagation();
                toggle(entry.id);
              }
            }}
          >
            {isDir ? (isExpanded ? "▼" : "▶") : ""}
          </span>
          <svg
            className="idbfs-tree__icon"
            viewBox="0 0 16 16"
            width="16"
            height="16"
            fill="none"
            stroke={color}
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={icon} />
          </svg>
          {isRenaming ? (
            <input
              ref={renameRef}
              className="idbfs-tree__input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void commitRename(entry);
                if (e.key === "Escape") setRenamingId(null);
              }}
              onBlur={() => void commitRename(entry)}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              className="idbfs-tree__name"
              onDoubleClick={(e) => {
                if (isRoot || readOnly) return;
                e.stopPropagation();
                setRenamingId(entry.id);
                setRenameValue(entry.name);
              }}
            >
              {entry.name}
            </span>
          )}
        </div>

        {isDir && isExpanded && (
          <div>
            {newFolderParentId === entry.id && (
              <div
                className="idbfs-tree__new-folder-row"
                style={{ paddingLeft: `${(depth + 1) * 16 + 4}px` }}
              >
                <span className="idbfs-tree__new-folder-icon"></span>
                <input
                  ref={newFolderRef}
                  className="idbfs-tree__input"
                  value={newFolderName}
                  placeholder="folder name"
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitNewFolder(entry.id);
                    if (e.key === "Escape") setNewFolderParentId(null);
                  }}
                  onBlur={() => void commitNewFolder(entry.id)}
                />
              </div>
            )}
            {children === undefined ? (
              <div
                className="idbfs-tree__child-hint"
                style={{ paddingLeft: `${(depth + 1) * 16 + 4}px` }}
              >
                loading…
              </div>
            ) : children.length === 0 && newFolderParentId !== entry.id ? (
              <div
                className="idbfs-tree__child-hint"
                style={{ paddingLeft: `${(depth + 1) * 16 + 4}px` }}
              >
                empty
              </div>
            ) : (
              children.map((c) => renderNode(c, depth + 1))
            )}
          </div>
        )}
      </div>
    );
  }

  const selectedEntries = contextMenu
    ? [...childMap.values()].flat().filter((e) => selectedIds.has(e.id))
    : [];
  const hasSelectedFiles = selectedEntries.some((e) => e.type === "file");
  const canDelete = selectedEntries.length > 0;

  return (
    <div
      ref={treeRef}
      className={`idbfs-tree idbfs-${theme}`}
      onDragOver={readOnly ? undefined : onDragOver}
      onDragLeave={readOnly ? undefined : onDragLeave}
      onDrop={readOnly ? undefined : onExternalDrop}
      onPaste={readOnly ? undefined : handlePasteImages}
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "c") {
          e.preventDefault();
          handleCopyToClipboard();
        }
        if (readOnly) return;
        if ((e.ctrlKey || e.metaKey) && e.key === "v") {
          void (async () => {
            let clipText: string | null = null;
            try {
              clipText = await navigator.clipboard.readText();
            } catch {}

            if (clipText && clipText !== clipboardMarker.current) {
              setClipboard([]);
              clipboardMarker.current = null;
              await handlePasteText(clipText);
              return;
            }

            if (clipboard.length > 0) {
              const allEntries = [...childMap.values()].flat();
              const selectedDir = allEntries.find(
                (en) => selectedIds.has(en.id) && en.type === "dir",
              );
              const pasteTarget = selectedDir ?? allEntries.find((en) => selectedIds.has(en.id));
              if (pasteTarget) await handlePaste(pasteTarget);
            }
          })();
        }
        if (e.key === "Delete") {
          e.preventDefault();
          void handleDelete();
        }
      }}
    >
      <div className="idbfs-tree__topbar">
        {toolbar && <div className="idbfs-tree__toolbar">{toolbar}</div>}

        <div className="idbfs-tree__topbar-right">
          <div className="idbfs-tree__filterbar" ref={filterMenuRef}>
            <button
              type="button"
              className="idbfs-tree__filter-btn"
              onClick={() => setFilterMenuOpen((v) => !v)}
              title="Filter which files are shown"
            >
              Filter ▾
            </button>
            {filterMenuOpen && (
              <div className="idbfs-tree__filter-menu">
                <label className="idbfs-tree__filter-option">
                  <input
                    type="checkbox"
                    checked={showHidden}
                    onChange={(e) => setShowHidden(e.target.checked)}
                  />
                  Show hidden files
                </label>
                <label className="idbfs-tree__filter-option">
                  <input
                    type="checkbox"
                    checked={showIgnored}
                    onChange={(e) => setShowIgnored(e.target.checked)}
                  />
                  Show gitignored files
                </label>
              </div>
            )}
          </div>

          {hasGithub && (
            <div className="idbfs-tree__gh-controls">
              <GhAuthButton />
              <GhActivityIndicator />
            </div>
          )}
        </div>
      </div>

      <div
        className="idbfs-tree__list"
        onClick={() => {
          setSelectedIds(new Set());
          setPreview(null);
        }}
      >
        {renderNode(DOT_ENTRY, 0)}
      </div>

      {preview && (
        <div className="idbfs-tree__preview">
          <div className="idbfs-tree__preview-name">{preview.name}</div>
          {preview.url && preview.mime.startsWith("image/") && (
            <img className="idbfs-tree__preview-img" src={preview.url} alt={preview.name} />
          )}
          {preview.url && preview.mime.startsWith("audio/") && (
            <audio className="idbfs-tree__preview-audio" controls src={preview.url} />
          )}
          {preview.text !== undefined && (
            <pre className="idbfs-tree__preview-text">{preview.text}</pre>
          )}
          {!preview.url && preview.text === undefined && (
            <div className="idbfs-tree__preview-mime">{preview.mime}</div>
          )}
        </div>
      )}

      {externalDrag && <DropOverlay />}

      <div
        ref={popoverRef}
        popover="manual"
        className="idbfs-tree__context-menu"
        onMouseDown={(e) => e.stopPropagation()}
        style={
          contextMenu
            ? {
                top: Math.min(contextMenu.y, window.innerHeight - 200),
                left: Math.min(contextMenu.x, window.innerWidth - 160),
              }
            : undefined
        }
      >
        {contextMenu && (
          <>
            {!readOnly && contextMenu.entry.type === "dir" && (
              <>
                <div
                  className="idbfs-tree__menu-item"
                  onClick={() => handleNewFolder(contextMenu.entry.id)}
                >
                  New folder
                </div>
                <div className="idbfs-tree__divider" />
              </>
            )}
            {!readOnly && contextMenu.entry.type === "dir" && clipboard.length > 0 && (
              <>
                <div
                  className="idbfs-tree__menu-item"
                  onClick={() => void handlePaste(contextMenu.entry)}
                >
                  Paste
                </div>
                <div className="idbfs-tree__divider" />
              </>
            )}
            <div className="idbfs-tree__menu-item" onClick={handleCopyToClipboard}>
              Copy
            </div>
            {!readOnly && contextMenu.entry.id !== ROOT_ID && (
              <div
                className="idbfs-tree__menu-item"
                onClick={() => {
                  setContextMenu(null);
                  setRenamingId(contextMenu.entry.id);
                  setRenameValue(contextMenu.entry.name);
                }}
              >
                Rename
              </div>
            )}
            {hasSelectedFiles && (
              <div className="idbfs-tree__menu-item" onClick={() => void handleDownload()}>
                Download
              </div>
            )}
            {hasGithub && (
              <GhContextMenuItems
                fs={fs}
                entry={contextMenu.entry}
                onChanged={() => setInternalRefresh((k) => k + 1)}
                close={() => setContextMenu(null)}
              />
            )}
            {renderContextMenuExtra?.(contextMenu.entry, () => setContextMenu(null))}
            {!readOnly && canDelete && (
              <>
                <div className="idbfs-tree__divider" />
                <div
                  className="idbfs-tree__menu-item idbfs-tree__menu-item--danger"
                  onClick={() => void handleDelete()}
                >
                  Delete
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function flatIds(
  childMap: Map<string, ListEntry[]>,
  expanded: Set<string>,
  isVisible: (entry: ListEntry) => boolean,
  parentId: string = ROOT_ID,
): string[] {
  const result: string[] = [];
  for (const entry of (childMap.get(parentId) ?? []).filter(isVisible)) {
    result.push(entry.id);
    if (entry.type === "dir" && expanded.has(entry.id)) {
      result.push(...flatIds(childMap, expanded, isVisible, entry.id));
    }
  }
  return result;
}

function findParentId(childMap: Map<string, ListEntry[]>, nodeId: string): string | undefined {
  for (const [parentId, children] of childMap) {
    if (children.some((c) => c.id === nodeId)) return parentId;
  }
  return undefined;
}

async function deleteDirById(fs: Idbfs, nodeId: string): Promise<void> {
  const children = await fs.lsById(nodeId);
  for (const c of children) {
    if (c.type === "dir") await deleteDirById(fs, c.id);
    else await fs.rmById(c.id);
  }
  await fs.rmDirById(nodeId);
}
