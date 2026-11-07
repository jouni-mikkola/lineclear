import { Component, type ErrorInfo, type ReactNode, useLayoutEffect, useRef } from "react";
import { clock } from "./format.ts";
import { play } from "./motion.ts";
import { Button } from "./parts.tsx";
import { Stop } from "./shapes.tsx";

// What the frame says when the data it shows is not fresh. Quiet and grey while the last data still stands and the
// way back is waiting; red only where something is broken. It never asks anyone to run a command.

/** Not updated (`stale`), no network (`lost`), an answer after 5 s (`slow`), the service stopped, a roadmap file that fails its check. */
type TroubleKind = "stale" | "lost" | "slow" | "stopped" | "broken";

export interface Trouble {
  kind: TroubleKind;
  /** When the last read worked (ms). */
  since?: number;
  /** The file and the lines its check refused, for `broken`. */
  file?: string;
  lines?: string[];
}

function words({ kind, since }: Trouble): string {
  const last = since === undefined ? "" : ` Not updated since ${clock(since)}.`;
  if (kind === "lost") return `No connection.${last} Retrying.`;
  if (kind === "slow") return `The server is slow to answer.${last} Waiting.`;
  if (kind === "stopped") return `Lineclear is not running.${last} Retrying.`;
  if (kind === "broken") return "The roadmap file does not pass its check.";
  return `${last.trim() || "Not updated."} Retrying.`;
}

export function Notice({ trouble }: { trouble: Trouble }) {
  const box = useRef<HTMLDivElement>(null);
  const red = trouble.kind === "stopped" || trouble.kind === "broken";
  // the frame gives each kind its own key, so it fades in once per kind
  useLayoutEffect(() => {
    if (box.current) play("part-change", box.current, [{ opacity: 0 }, { opacity: 1 }]);
  }, []);
  return (
    <div
      ref={box}
      className={`mb-4 rounded border px-4 py-3 text-sm ${red ? "border-stop/40 bg-raised text-fg" : "border-line bg-raised text-fg2"}`}
      role={red ? "alert" : "status"}
      data-notice={trouble.kind}
    >
      <p className="flex items-center gap-2">
        {red ? <Stop size={16} /> : <span className="size-2 shrink-0 rounded-full bg-fg3" />}
        <span>{words(trouble)}</span>
      </p>
      {trouble.kind === "broken" && trouble.lines && (
        <ul className="mt-2 space-y-0.5 break-words font-mono text-xs text-fg2" data-notice-lines>
          {trouble.lines.slice(0, 5).map((l) => (
            <li key={l}>{trouble.file ? l.replace(/^line (\d+): /, `${trouble.file}:$1: `) : l}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Holds one view: a bad answer shows the broken state in its place and the rest of the page stays. The view draws
 * again when `resetKey` changes or Try again is pressed.
 */
export class ViewBoundary extends Component<{ resetKey: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("A view could not draw its answer:", error.message, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex items-start gap-3 rounded border border-stop/40 bg-raised p-4" role="alert" data-view-broken>
        <Stop size={18} />
        <div className="min-w-0">
          <h1 className="font-medium text-fg">This view cannot draw the answer it got.</h1>
          <p className="mt-1 text-sm text-fg2">Settings shows what is wrong on each machine.</p>
          <div className="mt-3">
            <Button onClick={() => this.setState({ failed: false })}>Try again</Button>
          </div>
        </div>
      </div>
    );
  }
}
