import type { ReactNode } from "react";

// Text from tasks

// a link; `code`; a path from the root, home or here (`/etc/hosts`, `~/x`, `./x`); a path in a repo with a file at its end (`docs/ROADMAP.md`)
const TOKEN =
  /(https?:\/\/[^\s<>()"']*[^\s<>()"'.,;:!?])|`([^`\n]+)`|((?<![\w/:.~])(?:~|\.{1,2})?\/[\w.@<>-]+(?:\/[\w.@<>-]*)*|(?<![\w/:.~@-])(?:[\w.-]+\/)+[\w-]+\.\w+)/g;

/** Text from a task with its links as links and its paths and `code` as code chips. Everything else stays text. */
export function RichText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    // a path ends before the full stop or comma after it
    const path = m[3]?.replace(/[.,;:!?]+$/, "");
    if (i > at) out.push(text.slice(at, i));
    if (m[1]) {
      out.push(
        <a
          data-inline
          key={i}
          href={m[1]}
          target="_blank"
          rel="noreferrer"
          className="break-all text-fg underline decoration-fg3 underline-offset-4 hover:decoration-fg"
          data-link
        >
          {m[1].replace(/^https?:\/\//, "")}
        </a>,
      );
    } else {
      out.push(
        <code key={i} className="break-all rounded-sm bg-raised3 px-1.5 py-0.5 font-mono text-sm text-fg" data-code>
          {m[2] ?? path}
        </code>,
      );
    }
    at = i + (path ?? m[0]).length;
  }
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}
