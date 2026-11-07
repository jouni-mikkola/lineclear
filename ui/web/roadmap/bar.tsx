import type { RoadmapStep } from "../../../src/roadmap-view.ts";

export interface Phase {
  name: string;
  steps: RoadmapStep[];
}

export const doneCount = (p: Phase) => p.steps.filter((s) => s.state === "done").length;

function Fill({ share }: { share: number }) {
  return (
    <span className="block h-2 w-full overflow-hidden rounded-full bg-line2">
      <span className="block h-full rounded-full bg-clear" style={{ width: `${share}%` }} />
    </span>
  );
}

/** The bar: a rounded track per phase, as wide as its steps, filled green by what is done; the open phase is the bright one. */
export function Bar({ phases, open, onPick }: { phases: Phase[]; open: string; onPick?: (name: string) => void }) {
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
