import type { Idbfs, ListEntry, DirStats } from "../lib";
import { mimeFromName } from "../lib";
import { fileIconColor } from "../ui/icons";

export type Segment = { text: string; color?: string };

export type OutputLine =
  | { kind: "text"; text: string }
  | { kind: "line"; segments: Segment[] }
  | { kind: "image"; url: string; name: string }
  | { kind: "audio"; url: string; name: string }
  | { kind: "error"; text: string };

export interface CommandResult {
  output: OutputLine[];
  newCwd?: string;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function fmtAll(entries: ListEntry[]): OutputLine[] {
  const names = entries.map((e) => e.name);
  const sizes = entries.map((e) => (e.type === "file" ? humanSize(e.size) : ""));
  const nameWidth = Math.max(...names.map((n) => n.length));
  const sizeWidth = Math.max(...sizes.map((s) => s.length));
  return entries.map((e, i) => {
    const { color } = fileIconColor(e.name, e.type);
    return {
      kind: "line" as const,
      segments: [
        { text: e.type === "dir" ? "  " : "  ", color },
        { text: names[i].padEnd(nameWidth), color },
        { text: `  ${sizes[i].padStart(sizeWidth)}`, color: "#6c7086" },
      ],
    };
  });
}

function collectDu(stats: DirStats, rows: { path: string; size: string }[] = []) {
  for (const sub of stats.dirs) collectDu(sub, rows);
  rows.push({ path: stats.path, size: humanSize(stats.size) });
  return rows;
}

function fmtDu(stats: DirStats): OutputLine[] {
  const rows = collectDu(stats);
  const sizeWidth = Math.max(...rows.map((r) => r.size.length));
  const pathWidth = Math.max(...rows.map((r) => r.path.length));
  return rows.map((r) => ({
    kind: "line" as const,
    segments: [
      { text: r.size.padStart(sizeWidth), color: "#a6e3a1" },
      { text: "  " + r.path.padEnd(pathWidth), color: "#89b4fa" },
    ],
  }));
}

export async function runCommand(raw: string, cwd: string, fs: Idbfs): Promise<CommandResult> {
  const tokens = raw.trim().split(/\s+/);
  const cmd = tokens[0] ?? "";
  const arg = tokens[1];
  const arg2 = tokens[2];

  if (cmd.startsWith("./") || (cmd.startsWith("/") && cmd.length > 1)) {
    return runCommand(`view ${cmd}`, cwd, fs);
  }

  switch (cmd.toLowerCase()) {
    case "ls": {
      const target = arg ?? cwd;
      try {
        const entries = await fs.ls(target, cwd);
        if (entries.length === 0) return { output: [{ kind: "text", text: "(empty)" }] };
        return { output: fmtAll(entries) };
      } catch (e) {
        return { output: [{ kind: "error", text: String(e) }] };
      }
    }

    case "cd": {
      const target = arg ?? "/";
      try {
        const abs = fs.resolve(target, cwd);
        const stat = await fs.stat(abs);
        if (stat.type !== "dir")
          return { output: [{ kind: "error", text: `not a directory: ${abs}` }] };
        return { output: [], newCwd: abs };
      } catch (e) {
        return { output: [{ kind: "error", text: String(e) }] };
      }
    }

    case "rm": {
      if (!arg) return { output: [{ kind: "error", text: "usage: rm <file>" }] };
      try {
        await fs.rm(arg, cwd);
        return { output: [{ kind: "text", text: `removed ${arg}` }] };
      } catch (e) {
        return { output: [{ kind: "error", text: String(e) }] };
      }
    }

    case "rmdir": {
      if (!arg) return { output: [{ kind: "error", text: "usage: rmdir <dir>" }] };
      try {
        await fs.rmdir(arg, cwd);
        return { output: [{ kind: "text", text: `removed directory ${arg}` }] };
      } catch (e) {
        return { output: [{ kind: "error", text: String(e) }] };
      }
    }

    case "cp": {
      if (!arg || !arg2) return { output: [{ kind: "error", text: "usage: cp <src> <dest>" }] };
      try {
        await fs.cp(arg, arg2, cwd);
        return { output: [{ kind: "text", text: `${arg} -> ${arg2}` }] };
      } catch (e) {
        return { output: [{ kind: "error", text: String(e) }] };
      }
    }

    case "mv": {
      if (!arg || !arg2) return { output: [{ kind: "error", text: "usage: mv <src> <dest>" }] };
      try {
        await fs.mv(arg, arg2, cwd);
        return { output: [{ kind: "text", text: `${arg} -> ${arg2}` }] };
      } catch (e) {
        return { output: [{ kind: "error", text: String(e) }] };
      }
    }

    case "mkdir": {
      if (!arg) return { output: [{ kind: "error", text: "usage: mkdir <dir>" }] };
      try {
        await fs.mkdir(arg, cwd);
        return { output: [{ kind: "text", text: `created ${arg}` }] };
      } catch (e) {
        return { output: [{ kind: "error", text: String(e) }] };
      }
    }

    case "view": {
      if (!arg) return { output: [{ kind: "error", text: "usage: view <file>" }] };
      try {
        const file = await fs.readFile(arg, cwd);
        const mime = mimeFromName(file.name);
        const blob = new Blob([file.data], { type: mime });
        const url = URL.createObjectURL(blob);

        if (mime.startsWith("image/")) {
          return { output: [{ kind: "image", url, name: file.name }] };
        }
        if (mime.startsWith("audio/")) {
          return { output: [{ kind: "audio", url, name: file.name }] };
        }
        if (mime.startsWith("text/") || mime === "application/json") {
          const text = new TextDecoder().decode(file.data);
          URL.revokeObjectURL(url);
          return { output: text.split("\n").map((line) => ({ kind: "text", text: line })) };
        }
        URL.revokeObjectURL(url);
        return {
          output: [
            { kind: "text", text: `${file.name} (${mime}, ${file.size} bytes)` },
            { kind: "text", text: "binary file — cannot display as text" },
          ],
        };
      } catch (e) {
        return { output: [{ kind: "error", text: String(e) }] };
      }
    }

    case "stat": {
      if (!arg) return { output: [{ kind: "error", text: "usage: stat <path>" }] };
      try {
        const s = await fs.stat(arg, cwd);
        const fmtDate = (ts: number) => new Date(ts).toLocaleString();
        const mime = s.type === "file" ? mimeFromName(s.name) : "-";
        const size = s.type === "file" ? `${s.size} bytes` : "-";
        return {
          output: [
            { kind: "text", text: `path:     ${s.path}` },
            { kind: "text", text: `type:     ${s.type}` },
            { kind: "text", text: `size:     ${size}` },
            { kind: "text", text: `mime:     ${mime}` },
            { kind: "text", text: `created:  ${fmtDate(s.createdAt)}` },
            { kind: "text", text: `modified: ${fmtDate(s.modifiedAt)}` },
          ],
        };
      } catch (e) {
        return { output: [{ kind: "error", text: String(e) }] };
      }
    }

    case "du": {
      const target = arg ?? cwd;
      try {
        const stats = await fs.du(target, cwd);
        return { output: fmtDu(stats) };
      } catch (e) {
        return { output: [{ kind: "error", text: String(e) }] };
      }
    }

    case "pwd":
      return { output: [{ kind: "text", text: cwd }] };

    case "help":
      return {
        output: [
          { kind: "text", text: "commands:" },
          { kind: "text", text: "  ls [path]      list directory" },
          { kind: "text", text: "  cd [path]      change directory" },
          { kind: "text", text: "  mkdir <path>   create directory" },
          { kind: "text", text: "  rm <file>      remove file" },
          { kind: "text", text: "  rmdir <dir>    remove empty directory" },
          { kind: "text", text: "  mv <src> <dst> move or rename file or directory" },
          { kind: "text", text: "  cp <src> <dst> copy file or directory" },
          { kind: "text", text: "  du [path]      show disk usage" },
          { kind: "text", text: "  view <file>    display image, play audio, or show text" },
          { kind: "text", text: "  ./file /path   shorthand for view" },
          { kind: "text", text: "  stat <path>    show file metadata" },
          { kind: "text", text: "  pwd            print working directory" },
          { kind: "text", text: "  clear          clear the terminal" },
          { kind: "text", text: "" },
          { kind: "text", text: "upload: drag & drop files or paste image (ctrl+v)" },
        ],
      };

    case "":
      return { output: [] };

    default:
      return {
        output: [{ kind: "error", text: `unknown command: ${cmd}. type 'help' for usage` }],
      };
  }
}
