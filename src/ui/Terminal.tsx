import { useEffect, useRef } from "react";
import type { OutputLine } from "../commands";
import type { Idbfs } from "../lib";
import { CommandLine } from "./CommandLine";
import { useFileDrop, DropOverlay } from "./useFileDrop.tsx";
import "./Terminal.css";

interface Props {
  lines: Array<{ prompt?: string; output: OutputLine[] }>;
  cwd: string;
  fs: Idbfs;
  history: string[];
  onSubmit: (cmd: string) => void;
  onCompletions: (candidates: string[]) => void;
  onUploaded?: (names: string[]) => void;
  theme?: "light" | "dark";
  statusLine?: React.ReactNode;
}

export function Terminal({
  lines,
  cwd,
  fs,
  history,
  onSubmit,
  onCompletions,
  onUploaded,
  theme = "dark",
  statusLine,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const { externalDrag, onDragOver, onDragLeave, onDrop, onPaste } = useFileDrop(
    fs,
    cwd,
    onUploaded,
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  return (
    <div
      className={`idbfs-terminal idbfs-${theme}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onPaste={onPaste}
    >
      <div className="idbfs-terminal__output">
        {lines.map((block, i) => (
          <div key={i}>
            {block.prompt && <div className="idbfs-terminal__prompt">{block.prompt}</div>}
            {block.output.map((line, j) => (
              <OutputItem key={j} line={line} />
            ))}
          </div>
        ))}
        {statusLine}
        <CommandLine
          cwd={cwd}
          fs={fs}
          history={history}
          onSubmit={onSubmit}
          onCompletions={onCompletions}
        />
        <div ref={bottomRef} />
      </div>
      {externalDrag && <DropOverlay />}
    </div>
  );
}

function OutputItem({ line }: { line: OutputLine }) {
  if (line.kind === "line") {
    return (
      <div className="idbfs-terminal__line">
        {line.segments.map((seg, i) => (
          <span key={i} style={{ color: seg.color }}>
            {seg.text}
          </span>
        ))}
      </div>
    );
  }
  if (line.kind === "image") {
    return (
      <div className="idbfs-terminal__media">
        <img className="idbfs-terminal__image" src={line.url} alt={line.name} />
      </div>
    );
  }
  if (line.kind === "audio") {
    return (
      <div className="idbfs-terminal__media">
        <div className="idbfs-terminal__audio-name">{line.name}</div>
        <audio className="idbfs-terminal__audio" controls autoPlay src={line.url} />
      </div>
    );
  }
  if (line.kind === "error") {
    return <div className="idbfs-terminal__error">{line.text}</div>;
  }
  return <div className="idbfs-terminal__text">{line.text || " "}</div>;
}
