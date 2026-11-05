import { useLayoutEffect, useRef } from "react";
import * as rail from "../brand/rail.ts";
import { cssVar } from "../brand/rail.ts";
import { play, ring } from "./motion.ts";
import { Shapes } from "./rail.tsx";

export type TaskState = "queued" | "work" | "need" | "done";
/** What the line draws of a task besides its state. */
export interface TrainFacts {
  /** How far its worker says it is (0 to 1): the train creeps along the track as it grows. */
  progress?: number;
  /** How full the worker's context is, in tokens: the wagon behind the train. A compaction makes it fall. */
  load?: { used: number; limit: number };
  /** The account whose engine pulls it. */
  account?: string;
  /** What the task did, in the one concrete sentence of its card. */
  result?: string;
}
/** What a row of Home's table says of a task. */
export interface RowFacts {
  /** The other machine it runs on, when it is not this one. */
  machine?: string;
  /** Why it waits, when it does. */
  text?: string;
  /** What the agent did last (its last card) and when (ms). */
  last?: { text: string; at: number };
  /** Files its branch changed, and the result of its last check. */
  files?: number;
  check?: "pass" | "fail";
}
/** What the line draws of a project besides its tasks. */
export interface ProjectFacts {
  /** A planner is writing steps for it: track is being laid ahead. */
  planning?: boolean;
}
/** The lamp of an answer: green clear, amber waits for you, red broken, grey when something only takes its time. */
export type Tone = "clear" | "caution" | "stop" | "plain";

export const STATE_WORD: Record<TaskState, string> = {
  queued: "waits its turn",
  work: "at work",
  need: "waits for you",
  done: "merged",
};

const TONE: Record<Tone, string> = {
  clear: "var(--lc-clear)",
  caution: "var(--lc-caution)",
  stop: "var(--lc-stop)",
  plain: "var(--lc-fg2)",
};

const POP: Keyframe[] = [{ transform: "scale(0.4)" }, { transform: "scale(1.25)", offset: 0.6 }, { transform: "scale(1)" }];

/**
 * One picture per task state, from the picture language (docs/brand.md), so the state reads without its colour too:
 * an outline train in line, a lit train at work, an amber signal that waits for you, a green station merged. A
 * change of state plays its motion.
 */
export function Shape({ state, size = 14 }: { state: TaskState; size?: number }) {
  const host = useRef<HTMLSpanElement>(null);
  const was = useRef(state);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el || was.current === state) return;
    was.current = state;
    const svg = el.firstElementChild as Element;
    if (state === "work") {
      play("task-start", svg, POP);
      ring(el);
    } else if (state === "done") play("task-finish", svg, POP);
    else play("task-move", svg, POP);
  }, [state]);
  const [shapes, box] = PICTURE[state];
  return (
    <span ref={host} className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={box} aria-label={STATE_WORD[state]} role="img" className="overflow-visible" data-shape={state}>
        <Shapes shapes={shapes} />
      </svg>
    </span>
  );
}

// each state's part, and the square around it
const PICTURE: Record<TaskState, [rail.Shape[], string]> = {
  queued: [rail.train("queued", cssVar), "-16 -16 32 32"],
  work: [rail.train("work", cssVar), "-16 -16 32 32"],
  // the signal's head, where its lamp is
  need: [rail.signal("caution", cssVar), "-10 -34 20 20"],
  done: [rail.station("done", cssVar, 11), "-16 -16 32 32"],
};

/** The stop shape: only for what is broken. */
export function Stop({ size = 14, hidden }: { size?: number; hidden?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...(hidden ? { "aria-hidden": true } : { role: "img", "aria-label": "broken" })} className="shrink-0">
      <rect x="2" y="2" width="12" height="12" rx="2" fill="var(--lc-stop)" />
    </svg>
  );
}

/** A signal lamp in a tone, lit with a soft glow. */
export function Lamp({ tone, size = 20 }: { tone: Tone; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: TONE[tone], boxShadow: `0 0 ${size + 8}px ${TONE[tone]}` }}
    />
  );
}

function _Mark({ size = 28 }: { size?: number }) {
  return <img src="/brand/mark.svg" width={size} height={size} alt="" />;
}
