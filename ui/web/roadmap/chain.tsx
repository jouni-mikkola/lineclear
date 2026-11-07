import type { RoadmapData, RoadmapStep } from "../../../src/roadmap-view.ts";
import { StationPic } from "../../kit/index.ts";
import { roadmapPath } from "../routes.ts";
import { isOpen, stateWord } from "./common.tsx";

// A step's chain as rail: the steps it waits for before it and the steps that wait for it after it, each a station.

type Look = Parameters<typeof StationPic>[0]["look"];

const lookOf = (s: RoadmapStep): Look =>
  s.state === "done" ? "done" : s.state === "work" ? (s.task?.status === "need" ? "ask" : "work") : s.state === "ready" ? "next" : "ahead";

/** The steps reached from `id` through `next`, each once, ordered by how far they are from it. */
function reach(id: string, next: (id: string) => string[]): string[] {
  const depth = new Map<string, number>();
  const visit = (from: string, d: number) => {
    for (const to of next(from)) {
      if ((depth.get(to) ?? -1) >= d) continue;
      depth.set(to, d);
      visit(to, d + 1);
    }
  };
  visit(id, 1);
  return [...depth].sort((a, b) => a[1] - b[1]).map(([x]) => x);
}

function Station({ s, project, here, critical, byId }: { s: RoadmapStep; project: string; here: boolean; critical: boolean; byId: Map<string, RoadmapStep> }) {
  return (
    <li
      className={`relative ml-2 border-l-2 pl-6 ${critical ? "border-fg2" : "border-line3"}`}
      data-chain-step={s.id}
      data-critical={critical ? "yes" : "no"}
      {...(here ? { "aria-current": "step" as const } : {})}
    >
      <span className="absolute -left-[9px] top-4 rounded-full bg-base">
        <StationPic look={lookOf(s)} size={16} />
      </span>
      <a href={roadmapPath(project, s.id)} className="flex min-h-12 min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 py-2 text-sm hover:text-fg">
        <span className="tabular-nums text-fg2">{s.id}</span>
        <span className={`min-w-0 break-words ${here ? "font-semibold text-fg" : "text-fg2"}`}>{s.title}</span>
        <span className="text-fg3">{stateWord(s, byId)}</span>
        {critical && <span className="text-fg">critical path</span>}
      </a>
    </li>
  );
}

/** The chain of one step, or nothing when it waits for no step and none waits for it. */
export function StepChain({ d, id }: { d: RoadmapData; id: string }) {
  const live = d.steps.filter((s) => s.state !== "dropped");
  const byId = new Map(live.map((s) => [s.id, s]));
  const here = byId.get(id);
  if (!here) return null;
  const before = reach(id, (x) => (byId.get(x)?.after ?? []).filter((a) => byId.has(a))).reverse();
  const after = reach(id, (x) => live.filter((s) => s.after.includes(x)).map((s) => s.id));
  if (before.length + after.length === 0) return null;
  const path = new Set(d.line.path ?? []);
  const head = d.line.path?.[0];
  const words = !head
    ? ""
    : path.has(id) && isOpen(here)
      ? `This step is on the critical path: ${d.line.path?.length} steps wait on each other in a row, and the last of them sets the finish.`
      : `The critical path, which sets the finish, is ${d.line.path?.length} steps from ${head} to ${d.line.path?.at(-1)}.`;
  return (
    <section data-chain={id}>
      <h2 className="mb-1 text-sm font-medium text-fg3">Chain</h2>
      {words && (
        <p className="mb-3 text-sm text-fg2" data-chain-words>
          {words}
        </p>
      )}
      <ol>
        {[...before, id, ...after].map((x) => {
          const s = byId.get(x) as RoadmapStep;
          return <Station key={x} s={s} project={d.project} here={x === id} critical={path.has(x)} byId={byId} />;
        })}
      </ol>
    </section>
  );
}
