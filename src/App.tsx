import { useEffect, useState, useCallback } from "react";
import { connectIdbfs, Idbfs } from "./lib";
import { runCommand } from "./commands";
import type { OutputLine } from "./commands";
import { Terminal } from "./ui/Terminal";
import { FileTree } from "./ui/FileTree";

interface Block {
  prompt?: string;
  output: OutputLine[];
}

let fs: Idbfs;
const CWD_KEY = "idbfs:cwd";

export default function App() {
  const [ready, setReady] = useState(false);
  const [cwd, setCwd] = useState("/");
  const [history, setHistory] = useState<string[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [lines, setLines] = useState<Block[]>([
    { output: [{ kind: "text", text: "idbfs — IndexedDB filesystem" }] },
    { output: [{ kind: "text", text: "type 'help' for available commands" }] },
    { output: [{ kind: "text", text: "" }] },
  ]);

  useEffect(() => {
    connectIdbfs().then(async (connected) => {
      fs = connected;
      const saved = localStorage.getItem(CWD_KEY);
      if (saved && saved !== "/" && (await fs.exists(saved))) {
        setCwd(saved);
      }
      setReady(true);
    });
  }, []);

  const pushLines = useCallback((blocks: Block[]) => {
    setLines((prev) => [...prev, ...blocks]);
  }, []);

  const handleCommand = useCallback(
    async (cmd: string) => {
      const prompt = `${cwd} $ ${cmd}`;
      if (!cmd.trim()) {
        pushLines([{ prompt, output: [] }]);
        return;
      }

      setHistory((h) => [...h, cmd]);

      if (cmd.trim() === "clear") {
        setLines([]);
        return;
      }

      const result = await runCommand(cmd, cwd, fs);

      pushLines([{ prompt, output: result.output }]);
      if (result.newCwd) {
        setCwd(result.newCwd);
        localStorage.setItem(CWD_KEY, result.newCwd);
      }
      setRefreshKey((k) => k + 1);
    },
    [cwd, pushLines],
  );

  const handleUploaded = useCallback(
    (names: string[]) => {
      pushLines([{ output: names.map((n) => ({ kind: "text", text: `uploaded: ${n}` })) }]);
      setRefreshKey((k) => k + 1);
    },
    [pushLines],
  );

  const handleCompletions = useCallback(
    (candidates: string[]) => {
      pushLines([{ output: [{ kind: "text", text: candidates.join("  ") }] }]);
    },
    [pushLines],
  );

  if (!ready) {
    return (
      <div style={rootStyle}>
        <span style={{ color: "#4ec9b0" }}>initializing...</span>
      </div>
    );
  }

  return (
    <div style={rootStyle}>
      <FileTree fs={fs} refreshKey={refreshKey} cwd={cwd} onUploaded={handleUploaded} />
      <Terminal
        lines={lines}
        cwd={cwd}
        fs={fs}
        history={history}
        onSubmit={handleCommand}
        onCompletions={handleCompletions}
        onUploaded={handleUploaded}
      />
    </div>
  );
}

const rootStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "row",
  height: "100vh",
  width: "100vw",
  background: "#1e1e1e",
  fontFamily:
    '"CaskaydiaCove Nerd Font", "CaskaydiaMono Nerd Font", "JetBrainsMono Nerd Font", "FiraCode Nerd Font", "Cascadia Code", "Fira Code", "Consolas", monospace',
  fontSize: "14px",
  padding: "12px 16px",
  boxSizing: "border-box",
  overflow: "hidden",
};
