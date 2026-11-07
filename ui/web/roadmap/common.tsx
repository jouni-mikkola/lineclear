import type { ReactNode } from "react";
import type { RoadmapStep } from "../../../src/roadmap-view.ts";
import { SignalPic, StationPic, TrainPic } from "../../kit/index.ts";

// What the parts of a roadmap share.

export const isOpen = (s: RoadmapStep) => s.state !== "done" && s.state !== "dropped";
export const needsYou = (s: RoadmapStep) => s.state === "work" && s.task?.status === "need";
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A step as the picture language draws it: a station, a train while its task works, the amber signal when it asks. */
export function StepPic({ s, size = 14 }: { s: RoadmapStep; size?: number }) {
  if (needsYou(s)) return <SignalPic aspect="caution" size={size + 4} />;
  if (s.state === "work") return <TrainPic look="work" width={size + 10} />;
  return <StationPic look={s.state === "done" ? "done" : s.state === "ready" ? "next" : "ahead"} size={size} />;
}

/** Steps by title as short text: "Cart, Gift cards", or "Cart, Search and 248 more". A step is never named by its id alone. */
export function titleList(ids: string[], byId: Map<string, RoadmapStep>) {
  const titles = ids.map((id) => byId.get(id)?.title ?? "another step");
  return titles.length <= 3 ? titles.join(", ") : `${titles.slice(0, 2).join(", ")} and ${titles.length - 2} more`;
}

/** The steps a step still waits for: those in its `after` that are not done or dropped. */
export const openWaits = (s: RoadmapStep, byId: Map<string, RoadmapStep>) => s.after.filter((a) => byId.get(a) && isOpen(byId.get(a)!));

export function stateWord(s: RoadmapStep, byId: Map<string, RoadmapStep>) {
  if (s.state === "done") return "merged";
  if (s.state === "dropped") return "dropped";
  if (s.state === "work") return needsYou(s) ? "waits for you" : "at work";
  if (s.state === "ready") return "in line";
  return `after ${titleList(openWaits(s, byId), byId)}`;
}

/** A lines block such as a done-when, without the indent its continuation lines carry in the file. */
export function dedent(text: string) {
  const [first = "", ...rest] = text.split("\n");
  const indent = Math.min(...rest.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].length));
  return [first, ...rest.map((l) => l.slice(Number.isFinite(indent) ? indent : 0))].join("\n");
}

export const Label = ({ children }: { children: ReactNode }) => <h2 className="mb-3 text-sm font-medium text-fg3">{children}</h2>;

export const Chevron = ({ open }: { open: boolean }) => (
  <svg width="10" height="10" viewBox="0 0 10 10" className={`shrink-0 ${open ? "rotate-90" : ""}`} aria-hidden="true">
    <path d="M3 1.5 6.5 5 3 8.5" stroke="currentColor" strokeWidth="1.6" fill="none" />
  </svg>
);
