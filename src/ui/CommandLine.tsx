import { useRef, useEffect, useState } from "react";
import type { Idbfs } from "../lib";
import { complete } from "../lib";
import "./CommandLine.css";

interface Props {
  cwd: string;
  fs: Idbfs;
  onSubmit: (cmd: string) => void;
  onCompletions: (candidates: string[]) => void;
  history: string[];
}

export function CommandLine({ cwd, fs, onSubmit, onCompletions, history }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [histIdx, setHistIdx] = useState(-1);

  useEffect(() => {
    inputRef.current?.focus();
  });

  useEffect(() => {
    function onMouseUp(e: MouseEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "BUTTON" || tag === "AUDIO" || tag === "A") return;
      if (window.getSelection()?.toString()) return;
      inputRef.current?.focus();
    }
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, []);

  const prompt = `${cwd} $ `;

  async function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "u" && e.ctrlKey) {
      e.preventDefault();
      setValue("");
      setHistIdx(-1);
    } else if (e.key === "Tab") {
      e.preventDefault();
      const result = await complete(value, cwd, fs);
      if (result.value !== null) {
        setValue(result.value);
      } else if (result.candidates.length > 1) {
        onCompletions(result.candidates);
      }
    } else if (e.key === "Enter") {
      onSubmit(value);
      setValue("");
      setHistIdx(-1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.min(histIdx + 1, history.length - 1);
      setHistIdx(next);
      setValue(history[history.length - 1 - next] ?? "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.max(histIdx - 1, -1);
      setHistIdx(next);
      setValue(next === -1 ? "" : (history[history.length - 1 - next] ?? ""));
    }
  }

  return (
    <div className="idbfs-cmdline">
      <span className="idbfs-cmdline__prompt">{prompt}</span>
      <input
        ref={inputRef}
        className="idbfs-cmdline__input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKey}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
      />
    </div>
  );
}
