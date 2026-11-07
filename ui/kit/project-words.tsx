import type { ReactNode } from "react";
import { ago, exact } from "./format.ts";
import type { Stage, Task } from "./parts.tsx";
import { EnginePic } from "./rail.tsx";
import { STAGE_WORD, stageOf } from "./line-parts.tsx";

// The line's facts in words: the list of a project's work and an account's name line.

// what waits for you first, then what is furthest along
const ORDER: Record<Stage, number> = { ready: 0, review: 1, work: 2, queued: 3, done: 4 };
const rank = (t: Task) => (t.state === "need" ? -2 : t.stalled && t.state !== "done" ? -1 : ORDER[stageOf(t)]);
const byRank = (a: Task, b: Task) => rank(a) - rank(b);

/**
 * A project's work in words: the current step big, the next two small, the rest as a count. Full titles that wrap,
 * never cut.
 */
export function NowList({ tasks, waiting }: { tasks: Task[]; waiting?: Waiting }) {
  const open = tasks.filter((t) => t.state !== "done").sort(byRank);
  // the three first tasks are already named above with their stage: the running group adds the rest
  const shown = new Set(open.slice(0, 3).map((t) => t.id));
  const why = waiting && <WaitingGroups waiting={{ ...waiting, running: waiting.running.filter((t) => !shown.has(t.id)) }} />;
  if (!open.length) return why || null;
  const [first, ...rest] = open as [Task, ...Task[]];
  const word = (t: Task): ReactNode => (
    <span className={t.state === "need" ? "text-caution" : "text-fg3"}>
      {" · "}
      {t.state === "need" ? "waits for you" : t.stalled ? "no sign of life" : STAGE_WORD[stageOf(t)]}
    </span>
  );
  const title = (t: Task) => (
    <a href={`/task/${encodeURIComponent(t.id)}`} className="hover:underline focus-visible:outline-2 focus-visible:outline-accent" data-task-link={t.id}>
      {t.title}
    </a>
  );
  return (
    <div className="min-w-0 space-y-3 [overflow-wrap:anywhere]" data-now>
      <div>
        <p className="text-base text-fg" data-task-now={first.id}>
          {title(first)}
          <span className="text-sm">{word(first)}</span>
        </p>
        {rest.slice(0, 2).map((t) => (
          <p key={t.id} className="mt-0.5 text-sm text-fg2">
            {title(t)}
            {word(t)}
          </p>
        ))}
        {rest.length > 2 && <p className="mt-0.5 text-sm text-fg3">and {rest.length - 2} more</p>}
      </div>
      {why}
    </div>
  );
}

/** Why work waits in a project: what runs now, what each paused task waits for, why a ready step has not started. Each line is already in plain words. */
export interface Waiting {
  running: { id: string; title: string; stage: Stage; since: number }[];
  paused: { text: string; count: number }[];
  notStarted: { title: string; reason: string }[];
}

/** What runs now, what each paused task waits for and why each ready step has not started: three plain groups, each shown only when it has lines. */
function WaitingGroups({ waiting }: { waiting: Waiting }) {
  const { running, paused, notStarted } = waiting;
  if (!running.length && !paused.length && !notStarted.length) return null;
  const group = (name: string, lines: ReactNode[]) =>
    lines.length > 0 && (
      <ul className="space-y-0.5 text-sm text-fg3 [overflow-wrap:anywhere]" data-waiting={name}>
        {lines.map((l, i) => (
          // lines of one group are read whole each time, never reordered by the user
          <li key={i}>{l}</li>
        ))}
      </ul>
    );
  return (
    <div className="space-y-3" data-waiting-groups>
      {group(
        "running",
        running.map((t) => (
          <span key={t.id} title={exact(t.since)}>
            <span className="text-fg2">{t.title}</span> · {STAGE_WORD[t.stage]} for {ago(t.since)}
          </span>
        )),
      )}
      {group(
        "paused",
        paused.map((g) => g.text),
      )}
      {group(
        "not-started",
        notStarted.map((s) => (
          <>
            <span className="text-fg2">{s.title}</span> has not started: {s.reason}
          </>
        )),
      )}
    </div>
  );
}

/** An account's name line: its engine, its name, and that its provider reports no limit or how its week runs against an even spend. */
export function AccountHead({ account, unreported, pace, fill }: { account: string; unreported?: boolean; pace?: "ahead" | "on pace"; fill?: number }) {
  return (
    <p className="mb-2 flex min-w-0 items-center gap-2 text-sm text-fg">
      <span className="shrink-0" aria-hidden="true">
        <EnginePic size={22} ink={unreported ? "fg3" : "fg"} fill={fill} />
      </span>
      <span className="min-w-0 flex-1 truncate" title={account}>
        {account}
      </span>
      {unreported && <span className="shrink-0 text-xs text-fg3">no limit reported</span>}
      {pace && (
        <span className={`shrink-0 text-xs ${pace === "ahead" ? "text-caution" : "text-fg3"}`} data-pace={pace}>
          {pace}
        </span>
      )}
    </p>
  );
}
