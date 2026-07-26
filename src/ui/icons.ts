import { mimeFromName } from "../lib";

export type FileIcon = { path: string; color: string };

const ICONS = {
  folder: "M1 4a1 1 0 0 1 1-1h4l1.5 2H14a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4z",
  file: "M4 2h6l4 4v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm5.5.5V7H14",
  image:
    "M3 3h10a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm2 3a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm-2 4 3-3 2 2 2-2 3 3",
  audio: "M9 3v7.5A2.5 2.5 0 1 1 7 8V5l6-2v2L9 6.5M7 12.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  video:
    "M2 5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5zm10 1.5 3-2v7l-3-2V6.5z",
  pdf: "M4 2h6l4 4v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm1 7h6M5 11h4M5 13h6",
  archive:
    "M7 2h2v2H7V2zm0 2h2v2H7V4zm0 2h2v2H7V6zm-3-4h3v10a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1V2h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z",
  code: "M4 8l-2 2 2 2M8 5l-2 8M12 8l2 2-2 2",
  text: "M4 2h8a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm1 4h6M5 9h6M5 12h4",
};

export function fileIconColor(name: string, type: "file" | "dir"): FileIcon {
  if (type === "dir") return { path: ICONS.folder, color: "#89b4fa" };
  const mime = mimeFromName(name);
  if (mime.startsWith("image/")) return { path: ICONS.image, color: "#cba6f7" };
  if (mime.startsWith("audio/")) return { path: ICONS.audio, color: "#94e2d5" };
  if (mime.startsWith("video/")) return { path: ICONS.video, color: "#f5c2e7" };
  if (mime === "application/pdf") return { path: ICONS.pdf, color: "#f38ba8" };
  if (mime === "application/zip" || mime === "application/gzip" || mime === "application/x-tar")
    return { path: ICONS.archive, color: "#f9e2af" };
  if (mime === "application/wasm") return { path: ICONS.code, color: "#a6e3a1" };
  if (mime.startsWith("text/") || mime === "application/json")
    return { path: ICONS.text, color: "#cdd6f4" };
  return { path: ICONS.file, color: "#6c7086" };
}
