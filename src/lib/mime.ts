const MAP: Record<string, string> = {
  // image
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
  tiff: "image/tiff",
  tif: "image/tiff",
  // audio
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  aac: "audio/aac",
  m4a: "audio/mp4",
  // video
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  // text
  txt: "text/plain",
  md: "text/markdown",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  csv: "text/csv",
  xml: "text/xml",
  // code
  js: "text/javascript",
  mjs: "text/javascript",
  ts: "text/typescript",
  tsx: "text/typescript",
  jsx: "text/javascript",
  json: "application/json",
  yaml: "text/yaml",
  yml: "text/yaml",
  sh: "text/x-sh",
  py: "text/x-python",
  // document
  pdf: "application/pdf",
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
  wasm: "application/wasm",
};

// Extensionless dotfiles whose "extension" (per split-on-".") is really just
// the file's whole name — these are plain text by convention, not covered
// by the extension map above.
const DOTFILES = new Set([
  ".gitignore",
  ".gitattributes",
  ".gitmodules",
  ".dockerignore",
  ".editorconfig",
  ".env",
  ".npmrc",
  ".nvmrc",
  ".prettierrc",
  ".eslintrc",
  ".babelrc",
  ".bashrc",
  ".zshrc",
  ".profile",
]);

export function mimeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (DOTFILES.has(lower) || lower.startsWith(".env.")) return "text/plain";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MAP[ext] ?? "application/octet-stream";
}
