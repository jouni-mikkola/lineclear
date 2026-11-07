import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RoadmapStep } from "../../../src/roadmap-view.ts";
import { play, playKey } from "../../kit/index.ts";
import { roadmapPath } from "../routes.ts";
import { Chevron, isOpen, plural, StepPic, stateWord } from "./common.tsx";

// The line of one project: its phases as segments of one bar, and the open phase drawn station by station.
// The track runs down the page, so a phase of any size never scrolls sideways.

export interface Phase {
  name: string;
  steps: RoadmapStep[];
}

const doneCount = (p: Phase) => p.steps.filter((s) => s.state === "done").length;

/**
 * The open phase in order, as groups of steps that can run side by side: a step goes one group after the last
 * step of this phase that it waits for, so the steps of a group do not wait for each other.
 */
function parallelGroups(steps: RoadmapStep[]): RoadmapStep[][] {
  const depth = new Map<string, number>();
  const groups: RoadmapStep[][] = [];
  for (const s of steps) {
    const d = Math.max(-1, ...s.after.map((a) => depth.get(a) ?? -1)) + 1;
    depth.set(s.id, d);
    if (groups[d]) groups[d].push(s);
    else groups[d] = [s];
  }
  return groups.filter(Boolean);
}

function Fill({ share }: { share: number }) {
  return (
    <span className="block h-2 w-full overflow-hidden rounded-full bg-line2">
      <span className="block h-full rounded-full bg-clear" style={{ width: `${share}%` }} />
    </span>
  );
}

/** The bar: a rounded track per phase, as wide as its steps, filled green by what is done; the open phase is the bright one. */
function Bar({ phases, open, onPick }: { phases: Phase[]; open: string; onPick?: (name: string) => void }) {
  return (
    <div className="flex gap-2" data-bar aria-hidden={onPick ? undefined : "true"}>
      {phases.map((p) => {
        const share = (doneCount(p) / p.steps.length) * 100;
        const shade = p.name === open ? "" : "opacity-50";
        const grow = { flexGrow: p.steps.length, flexBasis: 0 };
        return onPick ? (
          <button
            key={p.name}
            type="button"
            style={grow}
            title={p.name}
            aria-label={`${p.name}, ${doneCount(p)} of ${p.steps.length} done`}
            aria-pressed={p.name === open}
            onClick={() => onPick(p.name)}
            className={`flex min-h-6 min-w-2 cursor-pointer items-center rounded-full hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${shade}`}
            data-segment={p.name}
          >
            <Fill share={share} />
          </button>
        ) : (
          <span key={p.name} style={grow} className={`min-w-2 ${shade}`}>
            <Fill share={share} />
          </span>
        );
      })}
    </div>
  );
}

/** One station: its picture on the track, its title, and a link to the step's own address. */
function Station({ s, project, byId, lane }: { s: RoadmapStep; project: string; byId: Map<string, RoadmapStep>; lane?: boolean }) {
  const quiet = !isOpen(s) || s.state === "waiting";
  const pic = useRef<HTMLSpanElement>(null);
  const was = useRef(s.state);
  useLayoutEffect(() => {
    const from = was.current;
    was.current = s.state;
    // a step that merges pulses its station once
    if (s.state === "done" && from !== "done" && pic.current)
      play("task-finish", pic.current, [{ transform: "scale(1)" }, { transform: "scale(1.6)", offset: 0.4 }, { transform: "scale(1)" }]);
  }, [s.state]);
  return (
    <li
      data-station={s.id}
      data-state={s.state}
      className={`relative min-w-0 ${lane ? "md:before:absolute md:before:inset-y-0 md:before:left-3 md:before:-ml-px md:before:w-0.5 md:before:bg-line2" : ""}`}
    >
      <a
        href={roadmapPath(project, s.id)}
        title={s.id}
        className={`relative flex min-h-10 min-w-0 items-center rounded py-1 pl-9 pr-2 hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent`}
      >
        <span ref={pic} aria-hidden="true" className={`absolute left-0 flex w-6 justify-center bg-base ${s.state === "dropped" ? "opacity-40" : ""}`} data-pic>
          <StepPic s={s} />
        </span>
        <span className={`min-w-0 break-words text-sm ${quiet ? "text-fg2" : "text-fg"} ${s.state === "dropped" ? "line-through" : ""}`}>{s.title}</span>
        <span className="sr-only"> ({stateWord(s, byId)})</span>
      </a>
    </li>
  );
}

/** The open phase: stations down the track; steps that run side by side sit in parallel columns and rejoin. */
function Track({ phase, project, byId, rise }: { phase: Phase; project: string; byId: Map<string, RoadmapStep>; rise: boolean }) {
  const groups = useMemo(() => parallelGroups(phase.steps), [phase]);
  const ol = useRef<HTMLOListElement>(null);
  // a phase you picked rises into place; the first one is simply there
  useLayoutEffect(() => {
    if (rise && ol.current)
      playKey("view", "view-change", ol.current, [
        { opacity: 0, transform: "translateY(8px)" },
        { opacity: 1, transform: "translateY(0)" },
      ]);
  }, [rise]);
  return (
    <ol
      ref={ol}
      className="relative mt-4 space-y-0.5 before:absolute before:bottom-3 before:left-3 before:-ml-px before:top-3 before:w-0.5 before:bg-line2"
      data-track={phase.name}
    >
      {groups.map((g) =>
        g.length === 1 ? (
          g.map((s) => <Station key={s.id} s={s} project={project} byId={byId} />)
        ) : (
          <li key={g.map((s) => s.id).join()} data-parallel={g.length} className="md:my-1 md:border-y md:border-line2">
            <ol className="grid grid-cols-1 gap-0.5 md:grid-cols-2 xl:grid-cols-3">
              {g.map((s) => (
                <Station key={s.id} s={s} project={project} byId={byId} lane />
              ))}
            </ol>
          </li>
        ),
      )}
    </ol>
  );
}

export function PhaseLine({ phases, current, project, byId }: { phases: Phase[]; current: string; project: string; byId: Map<string, RoadmapStep> }) {
  const [open, setOpen] = useState(current);
  const [list, setList] = useState(false);
  const [picked, setPicked] = useState(false);
  const opened = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    if (list && opened.current)
      playKey("view", "view-change", opened.current, [
        { opacity: 0, transform: "translateY(-8px)" },
        { opacity: 1, transform: "translateY(0)" },
      ]);
  }, [list]);
  const shown = phases.find((p) => p.name === open) ?? phases[0];
  if (!shown) return null;
  const pick = (name: string) => {
    setOpen(name);
    setPicked(true);
    setList(false);
  };
  return (
    <section className="mt-10" aria-label="Phases" data-line>
      <div className="hidden md:block">
        <Bar phases={phases} open={shown.name} onPick={pick} />
      </div>
      <div className="md:hidden">
        <Bar phases={phases} open={shown.name} />
        <button
          type="button"
          onClick={() => setList((l) => !l)}
          aria-expanded={list}
          className="mt-2 flex h-12 w-full items-center gap-2 rounded-lg bg-raised px-4 text-left hover:bg-raised3 focus-visible:outline-2 focus-visible:outline-accent"
          data-phase-row
        >
          <span className="min-w-0 flex-1 break-words text-fg">{shown.name}</span>
          <span className="shrink-0 text-sm tabular-nums text-fg3">{`${doneCount(shown)} of ${shown.steps.length} done`}</span>
          <span className="text-fg3">
            <Chevron open={list} />
          </span>
        </button>
        {list && (
          <ul ref={opened} className="mt-1 space-y-0.5" data-phase-list>
            {phases.map((p) => (
              <li key={p.name}>
                <button
                  type="button"
                  onClick={() => pick(p.name)}
                  aria-current={p.name === shown.name}
                  className="flex min-h-12 w-full items-center gap-3 rounded px-4 text-left text-sm text-fg2 hover:bg-raised"
                  data-phase-pick={p.name}
                >
                  <span className="min-w-0 flex-1 break-words">{p.name}</span>
                  <span className="shrink-0 tabular-nums text-fg3">{plural(p.steps.length, "step")}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-4 hidden break-words text-fg md:block" data-open-phase>
        {shown.name}
        <span className="ml-2 text-sm tabular-nums text-fg3">{`${doneCount(shown)} of ${shown.steps.length} done`}</span>
      </p>
      <Track key={shown.name} phase={shown} project={project} byId={byId} rise={picked} />
    </section>
  );
}
