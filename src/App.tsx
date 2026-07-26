import { useEffect, useState, useCallback } from "react";
import { connectIdbfs, Idbfs } from "./lib";
import type { Feature } from "./lib";
import { runCommand } from "./commands";
import type { OutputLine } from "./commands";
import { Terminal } from "./ui/Terminal";
import { FileTree } from "./ui/FileTree";
import { ghCommand } from "./github/commands";
import { GhTerminalStatusLine } from "./github/GhTerminalStatusLine";
import { maskSensitiveCommand } from "./github/maskCommand";

interface Block {
  prompt?: string;
  output: OutputLine[];
}

let fs: Idbfs;
const CWD_KEY = "idbfs:cwd";
const FEATURES: Feature[] = ["github"];

export default function App() {
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [cwd, setCwd] = useState("/");
  const [history, setHistory] = useState<string[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [lines, setLines] = useState<Block[]>([
    { output: [{ kind: "text", text: "idbfs — IndexedDB filesystem" }] },
    { output: [{ kind: "text", text: "type 'help' for available commands" }] },
    { output: [{ kind: "text", text: "" }] },
  ]);

  useEffect(() => {
    connectIdbfs()
      .then(async (connected) => {
        fs = connected;
        const saved = localStorage.getItem(CWD_KEY);
        if (saved && saved !== "/" && (await fs.exists(saved))) {
          setCwd(saved);
        }
        setReady(true);
      })
      .catch((err: unknown) => {
        setInitError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  const pushLines = useCallback((blocks: Block[]) => {
    setLines((prev) => [...prev, ...blocks]);
  }, []);

  const handleCommand = useCallback(
    async (cmd: string) => {
      // gh auth login takes a token as a plain argument — never echo it into
      // the visible transcript or recallable history, only into execution
      const displayCmd = maskSensitiveCommand(cmd);
      const prompt = `${cwd} $ ${displayCmd}`;
      if (!cmd.trim()) {
        pushLines([{ prompt, output: [] }]);
        return;
      }

      setHistory((h) => [...h, displayCmd]);

      if (cmd.trim() === "clear") {
        setLines([]);
        return;
      }

      // show the prompt immediately rather than waiting for the command to
      // finish — matters for slow gh commands, where the status line below
      // needs somewhere to sit while the command is still in flight
      pushLines([{ prompt, output: [] }]);

      const extra = FEATURES.includes("github") ? { gh: ghCommand } : undefined;
      const result = await runCommand(cmd, cwd, fs, extra);

      pushLines([{ output: result.output }]);
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

  if (initError) {
    return (
      <div style={rootStyle}>
        <span style={{ color: "#f38ba8" }}>failed to open idbfs: {initError}</span>
      </div>
    );
  }

  if (!ready) {
    return (
      <div style={rootStyle}>
        <span style={{ color: "#4ec9b0" }}>initializing...</span>
      </div>
    );
  }

  return (
    <div style={rootStyle}>
      <FileTree
        fs={fs}
        refreshKey={refreshKey}
        cwd={cwd}
        onUploaded={handleUploaded}
        features={FEATURES}
      />
      <Terminal
        lines={lines}
        cwd={cwd}
        fs={fs}
        history={history}
        onSubmit={handleCommand}
        onCompletions={handleCompletions}
        onUploaded={handleUploaded}
        statusLine={<GhTerminalStatusLine />}
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
