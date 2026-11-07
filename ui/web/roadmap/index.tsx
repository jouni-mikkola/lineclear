import { Dialog } from "@base-ui/react/dialog";
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RoadmapData, RoadmapStep } from "../../../src/roadmap-view.ts";
import type { StepRecord } from "../../../src/step-page.ts";
import type { PlanCard } from "../../../src/web.ts";
import { BackLink, flip, layoutOf, Part, play, type Spot, stop } from "../../kit/index.ts";
import type { Load } from "../data.ts";
import { isOpen, Label, needsYou, StepPic, stateWord } from "./common.tsx";
import { PhaseLine } from "./line.tsx";
import { LineOfRoadmap, RunSwitch } from "./summary.tsx";
import { ReleaseHead } from "./release.tsx";
import { AppliedStrip, PlanStrip } from "./since.tsx";
import { ProjectContext, StepDetails, StepPage } from "./step.tsx";

// One project's roadmap at `/<project>/roadmap`, a page under Home: what is at work and next, then the line: the phases as
// one bar and the open phase station by station. A card is a title, a result and a picture; the brief opens beside it.
// `/<project>/roadmap/<step>` is the page of one step.

/** The path segment of the phase track, which is not a step id. */
const TRACK = "track";

export function Roadmap({
  load,
  project,
  record,
  plan,
  planNote,
  step,
}: {
  load: Load<RoadmapData>;
  project: string;
  record: Load<StepRecord>;
  plan?: PlanCard;
  planNote?: string;
  step?: string;
}) {
  if (load.status === "error" && load.missing) return <NoProject project={project} error={load.error} />;
  if (step !== undefined && step !== TRACK) {
    if (load.status === "error") return <Part main state="error" label="The step" empty={{ text: "" }} error={load.error} onRetry={load.retry} />;
    return load.status === "ok" ? (
      <StepPage d={load.data} id={step} record={record} />
    ) : (
      <Part main state="loading" label="The step" empty={{ text: "" }} rows={4} />
    );
  }
  return (
    <>
      <BackLink href="/">Home</BackLink>
      <div className="mt-6">
        <Page load={load} plan={plan} planNote={planNote} />
      </div>
    </>
  );
}

/** An address whose project or roadmap file does not exist: the state is named, and Home is the way back. */
function NoProject({ project, error }: { project: string; error: string }) {
  return (
    <>
      <BackLink href="/">Home</BackLink>
      <div className="mt-6" data-missing={project}>
        <Part main state="empty" label="The roadmap" empty={{ text: `No roadmap for ${project}.`, hint: error }} />
      </div>
    </>
  );
}

function Page({ load, plan, planNote }: { load: Load<RoadmapData>; plan?: PlanCard; planNote?: string }) {
  if (load.status === "error") return <Part main state="error" label="The roadmap" empty={{ text: "" }} error={load.error} onRetry={load.retry} />;
  const d = load.status === "ok" ? load.data : undefined;
  return (
    <Part
      main
      state={!d ? "loading" : d.steps.length ? "filled" : "empty"}
      label="The roadmap"
      rows={4}
      empty={{
        text: `${d?.project ?? "This project"} has no steps yet.`,
        hint: (
          <>
            Write them in <code className="text-fg">docs/ROADMAP.md</code>, or ask the planner for a roadmap.
          </>
        ),
      }}
    >
      {d && (
        <Filled
          key={d.project}
          d={d}
          plan={plan?.project === d.project ? plan : undefined}
          planNote={plan && plan.project !== d.project ? `Request ${plan.task} is for ${plan.project}.` : planNote}
        />
      )}
    </Part>
  );
}

/** How many ready steps "Next" names: the rest wait in their phase. */
const NEXT = 6;

function Filled({ d, plan, planNote }: { d: RoadmapData; plan?: PlanCard; planNote?: string }) {
  const byId = useMemo(() => new Map(d.steps.map((s) => [s.id, s])), [d.steps]);
  const [shown, setShown] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [part, setPart] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const inPart = (s: RoadmapStep) => part === null || (s.parts ?? []).includes(part);

  // A phase is done when every step in it is done or dropped. The sections: at work and next, the rest of the phase
  // you are in, the phases after it, and the done phases at the bottom.
  const phases = d.phases.map((name) => ({ name, steps: d.steps.filter((s) => s.phase === name && inPart(s)) })).filter((p) => p.steps.length > 0);
  const finished = (steps: RoadmapStep[]) => steps.every((s) => !isOpen(s));
  const livePhases = phases.filter((p) => !finished(p.steps));
  const open = livePhases.flatMap((p) => p.steps.filter(isOpen));
  const now = [...open.filter(needsYou), ...open.filter((s) => s.state === "work" && !needsYou(s)), ...open.filter((s) => s.state === "ready").slice(0, NEXT)];
  const matches = q
    ? d.steps.filter((s) => inPart(s) && (s.id.toLowerCase().includes(q) || s.title.toLowerCase().includes(q) || s.result.toLowerCase().includes(q)))
    : [];
  const card = (s: RoadmapStep) => <StepCard key={s.id} s={s} byId={byId} onOpen={() => setShown(s.id)} />;
  const current = shown ? byId.get(shown) : undefined;
  const openPhase = livePhases[0] ?? phases.at(-1);

  return (
    <ProjectContext.Provider value={d.project}>
      <div data-roadmap>
        <h1 className="sr-only">Roadmap</h1>
        {d.release && <ReleaseHead r={d.release} />}
        {d.tasksError && <p className="break-words text-sm text-fg3">The tasks cannot be read, so no step shows its task: {d.tasksError}</p>}
        <RunSwitch key={d.project} project={d.project} paused={d.paused === true} />
        <LineOfRoadmap line={d.line} project={d.project} />
        {plan && <PlanStrip plan={plan} byId={byId} />}
        <AppliedStrip project={d.project} />
        {planNote && (
          <p className="mt-8 break-words text-sm text-fg3" data-plan-note>
            {planNote}
          </p>
        )}

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a step"
          aria-label="Find a step"
          className="mt-4 min-h-10 w-full rounded-sm border border-line bg-base px-3 text-sm text-fg placeholder:text-fg3 focus-visible:outline-2 focus-visible:outline-accent md:max-w-sm"
          data-step-search
        />

        {d.parts && <PartFilter parts={d.parts} value={part} onChange={setPart} />}

        {q ? (
          <section className="mt-8" aria-label="Matches">
            {matches.length ? <CardList steps={matches} card={card} /> : <p className="py-6 text-center text-sm text-fg2">No step matches "{query.trim()}".</p>}
          </section>
        ) : (
          <>
            {part !== null && phases.length === 0 && <p className="py-6 text-center text-sm text-fg2">No step in {part}.</p>}
            {now.length > 0 && (
              <section className="mt-8" aria-label="At work and next" data-section="now">
                <Label>At work and next</Label>
                <CardList steps={now} card={card} />
              </section>
            )}
            {openPhase && <PhaseLine phases={phases} current={openPhase.name} project={d.project} byId={byId} />}
          </>
        )}

        <StepPanel s={current} byId={byId} rounds={d.rounds} onClose={() => setShown(null)} />
      </div>
    </ProjectContext.Provider>
  );
}

/** One chip per part, each with its health as a lamp: green when nothing counts against it, amber when something does. A tap shows only that part's steps. */
function PartFilter({ parts, value, onChange }: { parts: { name: string; score: number }[]; value: string | null; onChange: (p: string | null) => void }) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {parts.map(({ name, score }) => {
        const tone = score ? "caution" : "clear";
        return (
          <button
            key={name}
            type="button"
            aria-pressed={value === name}
            onClick={() => onChange(value === name ? null : name)}
            data-part-chip={name}
            className={`flex min-h-9 cursor-pointer items-center gap-2 rounded-sm px-3 text-sm focus-visible:outline-2 focus-visible:outline-accent ${value === name ? "bg-raised3" : "bg-raised/50 hover:bg-raised"}`}
          >
            <span className="size-2 rounded-full" style={{ background: `var(--lc-${tone})` }} data-part-health={tone} />
            {name}
          </button>
        );
      })}
    </div>
  );
}

/** A grid of cards. A card whose step changes state slides to its new place. */
function CardList({ steps, card }: { steps: RoadmapStep[]; card: (s: RoadmapStep) => ReactNode }) {
  const list = useRef<HTMLUListElement>(null);
  useStepFlip(list, steps);
  return (
    <ul ref={list} className="relative grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
      {steps.map(card)}
    </ul>
  );
}

/**
 * Slides the cards to their new places when a step changes state: with the finish motion when a step merged, else
 * with the move motion. Opening a card's details changes the layout at once.
 */
function useStepFlip(ref: React.RefObject<HTMLUListElement | null>, steps: RoadmapStep[]) {
  const before = useRef<Map<string, Spot> | null>(null);
  const states = useRef<Map<string, string> | null>(null);
  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;
    const was = states.current;
    // a step that comes or goes, as the part filter makes it, moves the others the same way
    const changed = was && (was.size !== steps.length || steps.some((s) => was.get(s.id) !== s.state));
    if (changed && before.current) {
      const merged = steps.some((s) => s.state === "done" && was.get(s.id) !== "done");
      // a step that moves to another section arrives with the same motion
      flip(list, before.current, merged ? "task-finish" : "task-move", merged ? "task-finish" : "task-move");
    }
    before.current = layoutOf(list);
    states.current = new Map(steps.map((s) => [s.id, s.state]));
  });
  useLayoutEffect(() => {
    const list = ref.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const o = new ResizeObserver(() => (before.current = layoutOf(list)));
    o.observe(list);
    return () => o.disconnect();
  }, [ref]);
}

const GLOW = "0 0 0 1px var(--lc-fg), 0 0 28px 4px color-mix(in srgb, var(--lc-fg) 28%, transparent)";

const plain = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** A result that only restates the title adds nothing to a card. */
const restatesTitle = (s: RoadmapStep) => {
  const result = plain(s.result);
  const title = plain(s.title.replace(/^[A-Z]+\d+\s+/, ""));
  return result === title || result.includes(title);
};

/** A step: its state as the line's own picture, its title and its result when that says more. The id shows on hover only. */
function StepCard({ s, byId, onOpen }: { s: RoadmapStep; byId: Map<string, RoadmapStep>; onOpen: () => void }) {
  const glow = useRef<HTMLSpanElement>(null);
  const was = useRef(s.state);
  useLayoutEffect(() => {
    const from = was.current;
    was.current = s.state;
    // a step whose task starts glows once
    if (s.state !== "work" || from === "work" || !glow.current) return;
    stop(glow.current);
    play("task-start", glow.current, [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }]);
  }, [s.state]);
  const quiet = !isOpen(s) || s.state === "waiting";
  return (
    <li data-key={s.id} data-step={s.id} data-state={s.state} className="relative min-w-0">
      <span ref={glow} aria-hidden="true" className="pointer-events-none absolute inset-0 rounded opacity-0" style={{ boxShadow: GLOW }} />
      <button
        type="button"
        onClick={onOpen}
        title={s.id}
        aria-haspopup="dialog"
        className={`relative flex h-full w-full min-w-0 cursor-pointer items-start gap-3 rounded p-3 text-left focus-visible:outline-2 focus-visible:outline-accent ${
          needsYou(s) ? "bg-caution/10 hover:bg-caution/15" : quiet ? "bg-raised/50 hover:bg-raised" : "bg-raised hover:bg-raised3"
        }`}
      >
        <span aria-hidden="true" className={`mt-0.5 flex w-6 shrink-0 justify-center ${s.state === "dropped" ? "opacity-40" : ""}`} data-pic>
          <StepPic s={s} />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block break-words text-sm font-medium ${quiet ? "text-fg2" : "text-fg"} ${s.state === "dropped" ? "line-through" : ""}`}>
            {s.title}
          </span>
          {s.result && !restatesTitle(s) && (
            <span className="mt-1 block break-words text-sm text-fg2" data-result>
              {s.result}
            </span>
          )}
          <span className="sr-only"> ({stateWord(s, byId)})</span>
        </span>
      </button>
    </li>
  );
}

/** The side panel: the step's whole brief, for whoever wants it. Everything else shows only title and result. */
function StepPanel({ s, byId, rounds, onClose }: { s?: RoadmapStep; byId: Map<string, RoadmapStep>; rounds: number; onClose: () => void }) {
  // keep the last step while the panel slides out
  const last = useRef<RoadmapStep | undefined>(s);
  if (s) last.current = s;
  const step = s ?? last.current;
  return (
    <Dialog.Root open={!!s} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal keepMounted>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-base/80 transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
        <Dialog.Popup
          className="fixed inset-y-0 right-0 z-50 w-full max-w-[560px] overflow-y-auto border-l border-line bg-raised p-5 outline-none transition-transform duration-200 data-[ending-style]:translate-x-full data-[starting-style]:translate-x-full motion-reduce:transition-none md:p-8"
          data-panel
        >
          {step && (
            <>
              <div className="mb-5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-xs text-fg3">
                    <span aria-hidden="true" className="flex w-6 justify-center">
                      <StepPic s={step} />
                    </span>
                    <span>{step.id}</span>
                    <span>·</span>
                    <span>{stateWord(step, byId)}</span>
                  </p>
                  <Dialog.Title className="mt-2 break-words text-lg font-medium text-fg">{step.title}</Dialog.Title>
                  {step.result && <Dialog.Description className="mt-1 break-words text-fg2">{step.result}</Dialog.Description>}
                </div>
                <Dialog.Close className="min-h-9 shrink-0 rounded-sm bg-raised3 px-3 text-fg hover:bg-raised2 focus-visible:outline-2 focus-visible:outline-accent">
                  Close
                </Dialog.Close>
              </div>
              <StepDetails s={step} byId={byId} rounds={rounds} panel />
            </>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
