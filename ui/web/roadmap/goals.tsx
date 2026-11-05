import { useMemo, useState } from "react";
import type { Goal } from "../../../src/goals.ts";
import { day } from "../../../src/progress.ts";
import type { RoadmapData, RoadmapStep } from "../../../src/roadmap-view.ts";
import { Lamp, Part, type Tone } from "../../kit/index.ts";
import { inboxPath, roadmapPath } from "../routes.ts";
import { PRINT } from "./goals-print.ts";
import { Chevron, Label, plural, StepPic } from "./common.tsx";
import { LineOfRoadmap } from "./summary.tsx";

// The Roadmap for someone who leads the work: what each goal delivers, when, and how sure that is. No step ids, no
// rail. A tap on a goal opens its phases and steps; the phase track is at `/<project>/roadmap/track`.

const COLUMNS: { column: Goal["column"]; name: string }[] = [
  { column: "now", name: "Now" },
  { column: "next", name: "Next" },
  { column: "later", name: "Later" },
];

const TONE: Record<Exclude<Goal["confidence"], "done">, Tone> = { "on track": "clear", "at risk": "caution", late: "caution" };

/** How many merged steps "Delivered lately" lists. */
const LATELY = 6;

/** The sample pages carry no goals: each phase stands for one, so the rule of src/goals.ts stays out of the first load. */
function phaseGoals(d: RoadmapData): Goal[] {
  const now = d.history[0]?.at ?? 0;
  return d.phases.map((phase): Goal => {
    const own = d.steps.filter((x) => x.phase === phase && x.state !== "dropped");
    const left = own.filter((x) => x.state !== "done");
    const at = (state: string) => left.some((x) => x.state === state);
    const held = left.some((x) => x.task?.status === "need");
    return {
      title: phase,
      done: own.length - left.length,
      total: own.length,
      steps: own.map((x) => x.id),
      column: !left.length ? "done" : at("work") ? "now" : at("ready") ? "next" : "later",
      finish: now + left.length * 12 * 3_600_000,
      confidence: !left.length ? "done" : held ? "at risk" : "on track",
      reason: held ? "A step on its chain waits for you." : "On the pace of 7 days.",
    };
  });
}

export function GoalsPage({ d }: { d: RoadmapData }) {
  const sample = !d.goals?.length;
  const all = d.goals?.length ? d.goals : phaseGoals(d);
  const waiting = d.steps.find((x) => x.task?.status === "need");
  const decisions = sample && waiting ? [{ n: 7, question: waiting.task?.sub ?? "", step: waiting.title }] : (d.decisions ?? []);
  const byId = useMemo(() => new Map(d.steps.map((s) => [s.id, s])), [d.steps]);
  const delivered = d.history.slice(0, LATELY).flatMap((h) => byId.get(h.step) ?? []);
  const finished = all.filter((g) => g.column === "done");
  return (
    <div data-goals>
      <style>{PRINT}</style>
      <h1 className="sr-only">Roadmap</h1>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <LineOfRoadmap line={d.line} project={d.project} />
        </div>
        <a
          href={roadmapPath(d.project, "track")}
          className="shrink-0 text-sm text-fg2 underline decoration-line3 underline-offset-4 hover:text-fg"
          data-no-print
          data-track-link
        >
          Phase track
        </a>
      </div>
      <div className="grid grid-cols-1 gap-x-6 gap-y-8 md:grid-cols-3" data-columns>
        {COLUMNS.map(({ column, name }) => {
          const goals = all.filter((g) => g.column === column);
          return (
            <section key={column} aria-label={name} data-column={column} className="min-w-0">
              <Label>
                {name} <span className="font-normal tabular-nums">{goals.length}</span>
              </Label>
              {goals.length ? (
                <ul className="space-y-2">
                  {goals.map((g) => (
                    <GoalRow key={g.title} g={g} byId={byId} project={d.project} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-fg3">No goal here.</p>
              )}
            </section>
          );
        })}
      </div>
      {finished.length > 0 && (
        <section className="mt-8" aria-label="Done" data-column="done">
          <Label>Done</Label>
          <ul className="space-y-2">
            {finished.map((g) => (
              <GoalRow key={g.title} g={g} byId={byId} project={d.project} />
            ))}
          </ul>
        </section>
      )}
      <div className="mt-8 grid grid-cols-1 gap-x-6 gap-y-8 md:grid-cols-2">
        <section aria-label="Delivered lately" data-delivered>
          <Label>Delivered lately</Label>
          <Part state={delivered.length ? "filled" : "empty"} label="Delivered lately" empty={{ text: "Nothing has merged yet." }}>
            <ul className="space-y-1">
              {delivered.map((s) => (
                <li key={s.id} className="min-w-0 text-sm">
                  <a href={roadmapPath(d.project, s.id)} className="text-fg hover:underline" data-delivered-step={s.id}>
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </Part>
        </section>
        <section aria-label="Waits for you" data-decisions>
          <Label>Waits for you</Label>
          <Part state={decisions.length ? "filled" : "empty"} label="Decisions" empty={{ text: "Nothing waits for you." }}>
            <ul className="space-y-1">
              {decisions.map((x) => (
                <li key={x.n} className="min-w-0 text-sm">
                  <a href={inboxPath(x.n)} className="break-words text-fg hover:underline" data-decision={x.n}>
                    {x.step ? `${x.step}: ` : ""}
                    {x.question}
                  </a>
                </li>
              ))}
            </ul>
          </Part>
        </section>
      </div>
    </div>
  );
}

/** A goal: its title, its progress bar, its date and lamp with the reason. A tap opens its phases and steps. */
function GoalRow({ g, byId, project }: { g: Goal; byId: Map<string, RoadmapStep>; project: string }) {
  const [open, setOpen] = useState(false);
  const share = g.total ? (g.done / g.total) * 100 : 0;
  const phases = [...new Set(g.steps.flatMap((id) => byId.get(id)?.phase ?? []))];
  return (
    <li data-goal={g.title} data-confidence={g.confidence} className="min-w-0 rounded bg-raised">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full min-w-0 cursor-pointer flex-col gap-2 rounded p-3 text-left hover:bg-raised3 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="flex items-start gap-2">
          <span className="min-w-0 flex-1 break-words text-sm font-medium text-fg">{g.title}</span>
          <span className="mt-1 text-fg3" data-no-print>
            <Chevron open={open} />
          </span>
        </span>
        <span className="block h-2 overflow-hidden rounded-sm bg-line2" data-progress role="img" aria-label={`${g.done} of ${plural(g.total, "step")} done`}>
          <span className="block h-full rounded-sm bg-clear" style={{ width: `${share}%` }} />
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg2">
          <span className="tabular-nums" data-goal-progress>
            {g.done} of {plural(g.total, "step")}
          </span>
          {g.finish && <span data-goal-date>{day(g.finish)}</span>}
          {g.confidence === "done" ? (
            <span>done</span>
          ) : (
            <span className="inline-flex items-center gap-1.5" data-goal-confidence>
              <Lamp tone={TONE[g.confidence]} size={8} />
              {g.confidence}
            </span>
          )}
        </span>
        <span className="break-words text-xs text-fg2" data-goal-reason>
          {g.reason}
        </span>
      </button>
      {open && (
        <div className="space-y-3 px-3 pb-3" data-goal-detail>
          {phases.map((phase) => (
            <div key={phase}>
              <h3 className="text-xs text-fg3">{phase}</h3>
              <ul className="mt-1 max-h-72 space-y-1 overflow-y-auto">
                {g.steps.flatMap((id) => {
                  const s = byId.get(id);
                  return s && s.phase === phase ? (
                    <li key={id} className="flex min-w-0 items-center gap-2 text-sm">
                      <span aria-hidden="true" className="flex w-6 shrink-0 justify-center">
                        <StepPic s={s} />
                      </span>
                      <a href={roadmapPath(project, id)} className="min-w-0 break-words text-fg2 hover:text-fg hover:underline" data-goal-step={id}>
                        {s.title}
                      </a>
                    </li>
                  ) : (
                    []
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}
