import { useRef } from "react";
import { RoleIcon } from "./roles.tsx";
import { useFlip } from "./parts.tsx";
import type { Role } from "./settings.tsx";

const Arrow = ({ up }: { up?: boolean }) => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
    <path d={up ? "M1.5 6.5 5 3l3.5 3.5" : "M1.5 3.5 5 7l3.5-3.5"} stroke="currentColor" strokeWidth="1.6" fill="none" />
  </svg>
);

export interface Reason {
  state: string;
  reason: string;
}

/**
 * The reasons of a list after the owner moved a row, before the server answers: a full account stays full, and the
 * first of the rest is in use. `was` is the reasons in the order `before`.
 */
export function reorderReasons(before: string[], was: Reason[] | undefined, after: string[]): Reason[] | undefined {
  if (!was || was.length !== before.length) return undefined;
  const of = new Map(before.map((m, i) => [m, was[i]]));
  let chosen = false;
  return after.map((m) => {
    const r = of.get(m);
    if (!r) return { state: "next", reason: "" };
    if (!r || r.state === "full" || r.state === "key") return r ?? { state: "next", reason: "" };
    const note = r.reason.includes("usage not reported") ? ", usage not reported" : "";
    if (!chosen) {
      chosen = true;
      return { state: "use", reason: `in use${note}` };
    }
    return { state: "next", reason: `next, takes over when the ones above are full${note}` };
  });
}

const ACRONYMS = new Set(["glm", "gpt", "llm", "ai", "oss"]);

/** A model id as people say it, "Model Mid 5.5", and the account it runs on: `account/model-mid-5-5`. */
function modelName(id: string): { name: string; account?: string } {
  const slash = id.lastIndexOf("/");
  const account = slash > 0 ? id.slice(0, slash) : undefined;
  const words = id
    .slice(slash + 1)
    .replace(/(^|-)(\d{1,2})-(\d{1,2})(?=$|-)/g, "$1$2.$3")
    .split("-")
    .filter(Boolean)
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : /^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)));
  return { name: words.join(" ") || id, account };
}

/**
 * A role's models as a numbered list, best first: number 1 is used first, and when its account is full the next one
 * takes over. Each moves up or down with one click, and slides to its new place.
 */
export function ModelList({
  role,
  models,
  reasons,
  onMove,
}: {
  role: Role;
  models: string[];
  reasons?: Reason[];
  onMove?: (from: number, to: number) => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  useFlip(list, "model-move");
  const move =
    "inline-flex size-11 items-center justify-center rounded-sm md:size-8 text-fg2 hover:bg-raised3 hover:text-fg disabled:pointer-events-none disabled:opacity-25";
  return (
    <div className="min-w-0">
      <h3 className="flex items-center gap-2 text-sm font-medium capitalize text-fg">
        <span className="text-fg2">
          <RoleIcon role={role} size={16} hidden />
        </span>
        {role}
      </h3>
      {models.length === 0 ? (
        <p className="mt-2 text-sm text-fg2">No models.</p>
      ) : (
        <ol ref={list} className="relative mt-2 space-y-1" data-models={role}>
          {models.map((m, i) => {
            const { name, account } = modelName(m);
            const reason = reasons?.[i];
            return (
              <li
                key={m}
                data-key={m}
                className={`flex min-w-0 items-center gap-2.5 rounded-sm py-1.5 pl-2 pr-1 ${i === 0 ? "bg-raised3" : "bg-raised2"}`}
                data-model={m}
                title={m}
              >
                <span
                  className={`grid size-5 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums ${i === 0 ? "bg-clear/20 text-clear" : "bg-raised3 text-fg2"}`}
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block break-words text-sm ${i === 0 ? "font-medium text-fg" : "text-fg2"}`}>{name}</span>
                  {reason && (
                    <span
                      className={`mt-0.5 block text-xs ${reason.state === "use" ? "text-clear" : reason.state === "next" ? "text-fg3" : "text-caution"}`}
                      data-reason={reason.state}
                    >
                      {reason.reason}
                    </span>
                  )}
                  {account && (
                    <span className="mt-0.5 inline-block max-w-full truncate rounded-sm bg-raised2 px-1.5 align-top text-xs text-fg2">{account}</span>
                  )}
                </span>
                {onMove && models.length > 1 && (
                  <span className="flex shrink-0">
                    <button type="button" className={move} disabled={i === 0} onClick={() => onMove(i, i - 1)} aria-label={`Move ${m} up`} data-up={m}>
                      <Arrow up />
                    </button>
                    <button
                      type="button"
                      className={move}
                      disabled={i === models.length - 1}
                      onClick={() => onMove(i, i + 1)}
                      aria-label={`Move ${m} down`}
                      data-down={m}
                    >
                      <Arrow />
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
