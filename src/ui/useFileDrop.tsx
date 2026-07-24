import { useCallback, useState } from "react";
import type { Idbfs } from "../lib";
import "./DropOverlay.css";

export function DropOverlay() {
  return (
    <div className="idbfs-drop-overlay">
      <span className="idbfs-drop-overlay__label">drop files to upload</span>
    </div>
  );
}

export function useFileDrop(fs: Idbfs, cwd: string, onUploaded?: (names: string[]) => void) {
  const [externalDrag, setExternalDrag] = useState(false);

  const onPaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItems = items.filter((i) => i.type.startsWith("image/"));
      if (imageItems.length === 0) return;
      e.preventDefault();
      const uploaded: string[] = [];
      for (const item of imageItems) {
        const file = item.getAsFile();
        if (!file) continue;
        const ext = item.type.split("/")[1] ?? "png";
        const name = `paste-${Date.now()}.${ext}`;
        await fs.writeFile(name, await file.arrayBuffer(), cwd);
        uploaded.push(name);
      }
      if (uploaded.length > 0) onUploaded?.(uploaded);
    },
    [fs, cwd, onUploaded],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setExternalDrag(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setExternalDrag(false);
  }, []);

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setExternalDrag(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      const uploaded: string[] = [];
      for (const file of files) {
        await fs.writeFile(file.name, await file.arrayBuffer(), cwd);
        uploaded.push(file.name);
      }
      onUploaded?.(uploaded);
    },
    [fs, cwd, onUploaded],
  );

  const clearDrag = useCallback(() => setExternalDrag(false), []);

  return { externalDrag, onDragOver, onDragLeave, onDrop, onPaste, clearDrag };
}
