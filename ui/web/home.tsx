import { useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useRef, useState } from "react";
import { AddProject, type Browser, DispatcherHead, type DispatcherState, type InboxItem, Part, TheLine } from "../kit/index.ts";
import { addProject, detect, findRepos, type HomeData, type Load } from "./data.ts";
import { rowsOf, TaskTable } from "./home-table.tsx";
import { InboxStrip, useHeldAnswers } from "./inbox-strip.tsx";
import { UsageMark } from "./usage-mark.tsx";

// Home at `/`: the line on top, the ask strip when something waits for you, the table of working tasks, the
// Dispatcher's chat on the right and the usage mark in the footer. It says nothing about itself: no subtitles, hints or counts.

const UsageSheet = lazy(() => import("./usage-sheet.tsx").then((m) => ({ default: m.UsageSheet })));

export function Home({
  home,
  open: asks,
  asksRead,
  ask,
  errors,
  onAnswer,
  browsers,
  sample,
  chat,
  chatState,
  usageOpen,
  setUsageOpen,
}: {
  home: Load<HomeData>;
  open: InboxItem[];
  asksRead: boolean;
  /** The ask the address names, shown first. */
  ask?: string;
  /** Why an answer did not reach the server, by ask. */
  errors: Record<string, string>;
  onAnswer: (item: InboxItem, choice: string, note?: string) => void;
  browsers: Load<Browser[]>;
  sample: boolean;
  /** The Dispatcher's chat, drawn in the column on the right. */
  chat: React.ReactNode;
  chatState: DispatcherState;
  usageOpen: boolean;
  setUsageOpen: (open: boolean) => void;
}) {
  const client = useQueryClient();
  const { open, held, choose, undo } = useHeldAnswers(asks, onAnswer);
  // the sheet loads on the first open and stays, so it can close with its motion
  const sheetShown = useRef(false);
  if (usageOpen) sheetShown.current = true;
  // the card stays after Start, so what it said stays readable when the new project fills the page
  const [started, setStarted] = useState(false);
  const first = (home.status === "ok" && !home.data.projects.length) || started;
  const repos = useQuery({ queryKey: ["repos", sample], queryFn: () => findRepos(sample), enabled: first, staleTime: Number.POSITIVE_INFINITY });
  if (home.status === "error") return <Part main state="error" label="Home" empty={{ text: "" }} error={home.error} onRetry={home.retry} />;
  const d = home.status === "ok" ? home.data : undefined;
  const rows = d ? rowsOf(d.projects, d.loose, d.host ?? "this machine", open) : [];
  // a paused project with nothing at work and a project with no steps are not big rows of the line (LIN-345 hides paused spaces everywhere)
  const onLine = (d?.projects ?? []).filter(
    (p) => (p.total > 0 || p.tasks.length > 0) && !(p.paused && !p.tasks.some((t) => t.state === "work" || t.state === "need")),
  );
  const inbox = Object.fromEntries(open.flatMap((i) => (i.task ? [[i.task, `/inbox/${encodeURIComponent(i.id)}`]] : [])));
  return (
    <div className="flex flex-col gap-4 lg:h-dvh lg:flex-row lg:gap-0" data-home>
      <h1 className="sr-only">Home</h1>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 px-5 pt-4 md:px-10 lg:py-6 lg:pr-6">
        <InboxStrip open={open} held={held} onChoose={choose} onUndo={undo} ask={ask} errors={errors} read={asksRead} />
        {(
          [
            ["waste", d?.waste],
            ["doctor", d?.doctor],
          ] as const
        ).map(
          ([kind, lines]) =>
            !!lines?.length && (
              <ul key={kind} aria-label={kind} className="flex flex-col gap-1 text-sm text-caution" {...{ [`data-${kind}`]: "" }}>
                {lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ),
        )}
        {first && (
          <div data-part="First project">
            <AddProject
              repos={repos.data}
              onDetect={(repo) => detect(repo, sample)}
              onSave={async (p) => {
                const r = await addProject(p, sample);
                if (!("error" in r)) {
                  setStarted(true);
                  await client.invalidateQueries({ queryKey: ["home"] });
                }
                return r;
              }}
            />
          </div>
        )}
        <section aria-label="The line" className="max-h-[25%] min-h-52 shrink-0 overflow-y-auto overflow-x-hidden lg:min-h-0 lg:max-h-[25dvh]" data-line>
          <Part state={d ? "filled" : "loading"} label="The line" empty={{ text: "" }} rows={2}>
            {!!onLine.length && (
              <TheLine
                projects={onLine}
                waiting={open.length}
                inbox={inbox}
                offline={home.status === "ok" ? home.offline : undefined}
                writing={d?.dispatcher?.writing}
                legend={false}
              />
            )}
          </Part>
        </section>
        <section aria-label="Working tasks" className="min-h-64 flex-1 lg:min-h-0">
          <Part state={!d ? "loading" : rows.length ? "filled" : "empty"} label="Working tasks" empty={{ text: "Nothing is at work." }} rows={3}>
            <TaskTable rows={rows} sample={sample} browsers={browsers} onChoose={choose} />
          </Part>
        </section>
      </div>
      <aside
        aria-label="Dispatcher"
        className="flex min-h-[70dvh] flex-col border-line px-5 pb-6 lg:h-dvh lg:min-h-0 lg:w-[400px] lg:shrink-0 lg:border-l lg:px-0 lg:pb-0"
        data-chat-column
      >
        <div className="shrink-0 px-0 py-3 lg:px-4">
          <DispatcherHead state={chatState} beside />
        </div>
        <div className="min-h-0 flex-1">{chat}</div>
        <div className="shrink-0 border-t border-line px-0 py-2 lg:px-4">
          <UsageMark d={d} onOpen={() => setUsageOpen(true)} />
        </div>
      </aside>
      {(usageOpen || sheetShown.current) && (
        <Suspense fallback={null}>
          <UsageSheet d={d} open={usageOpen} onClose={() => setUsageOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
