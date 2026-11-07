import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "./parts.tsx";

// A task's live terminal: the screen as herdr draws it, a box to type into and the keys a keyboard-less phone needs.

const TERMINAL_KEYS = [
  ["Enter", "enter"],
  ["Esc", "esc"],
  ["Tab", "tab"],
  ["Up", "up"],
  ["Down", "down"],
  ["Ctrl-C", "ctrl-c"],
] as const;

const PALETTE = [
  "var(--lc-line2)",
  "var(--lc-stop)",
  "var(--lc-clear)",
  "var(--lc-caution)",
  "var(--lc-fg2)",
  "var(--lc-accent)",
  "var(--lc-fg3)",
  "var(--lc-fg)",
];

interface Run {
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
}

const ESC = String.fromCharCode(27);
const ESCAPES = new RegExp(`${ESC}\\[([0-9;]*)([A-Za-z])|${ESC}[^[]`, "g");

type Style = Omit<Run, "text">;

/** One colour code (or the run of codes of an extended colour) applied to a style; gives how many codes it used. */
function applyCode(style: Style, codes: number[], i: number): [Style, number] {
  const c = codes[i] ?? 0;
  const bright = c >= 90 && c <= 97;
  if (c === 0) return [{}, 1];
  if (c === 1) return [{ ...style, bold: true }, 1];
  if (c === 2) return [{ ...style, dim: true }, 1];
  if (c === 22) return [{ ...style, bold: false, dim: false }, 1];
  if (c === 39) return [{ ...style, color: undefined }, 1];
  if ((c >= 30 && c <= 37) || bright) return [{ ...style, color: PALETTE[c - (bright ? 90 : 30)] }, 1];
  if (c === 38 && codes[i + 1] === 5) {
    const n = codes[i + 2] ?? 7;
    return [{ ...style, color: n < 16 ? PALETTE[n % 8] : undefined }, 3];
  }
  if (c === 38 && codes[i + 1] === 2)
    return [{ ...style, color: `color(srgb ${(codes[i + 2] ?? 0) / 255} ${(codes[i + 3] ?? 0) / 255} ${(codes[i + 4] ?? 0) / 255})` }, 5];
  return [style, 1];
}

/** The text with its ANSI colour codes as runs of one style each. Any other escape is dropped. */
function ansiRuns(ansi: string): Run[] {
  const runs: Run[] = [];
  let style: Style = {};
  let at = 0;
  const push = (text: string) => text && runs.push({ text, ...style });
  for (const m of ansi.matchAll(ESCAPES)) {
    push(ansi.slice(at, m.index));
    at = (m.index ?? 0) + m[0].length;
    if (m[2] !== "m") continue;
    const codes = (m[1] || "0").split(";").map(Number);
    for (let i = 0; i < codes.length; ) {
      const [next, used] = applyCode(style, codes, i);
      style = next;
      i += used;
    }
  }
  push(ansi.slice(at));
  return runs;
}

/** The screen, kept scrolled to its bottom while you are there. */
export function TerminalScreen({ ansi, label }: { ansi: string; label: string }) {
  const box = useRef<HTMLPreElement>(null);
  const runs = useMemo(() => ansiRuns(ansi), [ansi]);
  // runs changes with the screen: keep the bottom in view while you are at it
  useEffect(() => {
    const el = box.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [runs]);
  return (
    <pre
      ref={box}
      role="log"
      tabIndex={0}
      aria-label={label}
      data-terminal-screen
      className="h-[min(60dvh,32rem)] overflow-auto whitespace-pre rounded-lg border border-line bg-base p-3 font-mono text-xs leading-5 text-fg2"
    >
      {runs.map((r, i) => (
        <span key={i} style={{ color: r.color, fontWeight: r.bold ? 600 : undefined, opacity: r.dim ? 0.6 : undefined }}>
          {r.text}
        </span>
      ))}
    </pre>
  );
}

/** What you type into the terminal, and its keys. `onSend` resolves to a reason when the words did not go. */
export function TerminalInput({
  onSend,
  onKey,
  disabled,
}: {
  onSend: (text: string) => Promise<string | undefined>;
  onKey: (key: string) => Promise<string | undefined>;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [failed, setFailed] = useState<string>();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || disabled) return;
    const error = await onSend(text);
    setFailed(error);
    if (!error) setText("");
  };
  return (
    <div className="mt-3 space-y-3" data-terminal-input>
      <form className="flex items-center gap-2" onSubmit={(e) => void submit(e)}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={disabled}
          aria-label="Type into the terminal"
          placeholder="Type into the terminal"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-raised px-3 font-mono text-sm text-fg outline-none placeholder:text-fg3 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
        />
        <Button submit>Send</Button>
      </form>
      <div className="flex flex-wrap gap-2">
        {TERMINAL_KEYS.map(([label, key]) => (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => void onKey(key).then(setFailed)}
            className="min-h-9 rounded-sm bg-raised3 px-3 text-sm text-fg hover:bg-line2 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
          >
            {label}
          </button>
        ))}
      </div>
      {failed && (
        <p role="alert" className="text-sm text-caution">
          {failed}
        </p>
      )}
    </div>
  );
}
