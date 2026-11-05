import type { ChangedFile } from "../../src/task-changes.ts";

// A task's changes for review, read only: one block per file with its lines in the colours of a diff, and a link to
// the pull request. Added lines are green and removed ones grey: red stays for what is broken. The lines scroll sideways inside their block, so a long line never widens the page.

const lineColour = (l: string) =>
  l.startsWith("+") ? "bg-clear/10 text-clear" : l.startsWith("-") ? "bg-raised3 text-fg3" : l.startsWith("@@") ? "text-fg3" : "text-fg2";

/** One changed file: its path and counts as the heading, its diff lines when opened. */
export function DiffFile({ f, open }: { f: ChangedFile; open?: boolean }) {
  return (
    <details open={open} className="rounded-lg border border-line bg-raised" data-diff-file={f.path}>
      <summary className="flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm focus-visible:outline-2 focus-visible:outline-accent">
        <span className="min-w-0 flex-1 break-all font-mono text-fg">{f.path}</span>
        <span className="shrink-0 font-mono text-xs tabular-nums">
          <span className="text-clear">+{f.added}</span> <span className="text-fg3">-{f.removed}</span>
        </span>
      </summary>
      {f.binary ? (
        <p className="border-t border-line px-3 py-2 text-sm text-fg3">A binary file.</p>
      ) : (
        <pre className="overflow-x-auto border-t border-line py-2 font-mono text-xs leading-5">
          {f.lines.map((l, i) => (
            <span key={i} className={`block min-w-max px-3 ${lineColour(l)}`}>
              {l || " "}
            </span>
          ))}
          {f.cut > 0 && <span className="block px-3 text-fg3">{f.cut} more lines in the branch.</span>}
        </pre>
      )}
    </details>
  );
}

/** The pull request of a task's branch, as a link out. */
export function PullRequest({ pr }: { pr: { number: number; url: string; state: string; title: string } }) {
  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      data-pr
      className="flex min-h-11 items-center gap-3 rounded-lg border border-line bg-raised px-3 text-sm hover:border-line2 focus-visible:outline-2 focus-visible:outline-accent"
    >
      <span className="shrink-0 text-fg3">#{pr.number}</span>
      <span className="min-w-0 flex-1 break-words text-fg">{pr.title}</span>
      <span className="shrink-0 text-xs lowercase text-fg3">{pr.state}</span>
    </a>
  );
}
