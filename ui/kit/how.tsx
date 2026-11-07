import type { RoleName } from "../brand/roles.ts";
import { stageOf } from "./line-parts.tsx";
import type { Project } from "./parts.tsx";

// What each role holds right now, for the role chain on Home.
export interface RoleCount {
  text: string;
  /** The count asks for you. */
  you?: boolean;
  /** The role has work in hand now. */
  live?: boolean;
  /** Goes up each time the role takes something new; the chain answers with a ring. */
  beat?: number;
}

/** What only the page knows: the requests being planned and the ones you just sent. */
export interface Doing {
  planning?: number;
  sends?: number;
  sending?: boolean;
}

/** What each role holds right now, from Home's projects and the Inbox's count. */
export function roleCounts(projects: Project[], waiting = 0, now: Doing = {}): Partial<Record<RoleName, RoleCount>> {
  const tasks = projects.flatMap((p) => p.tasks);
  const at = (stage: string) => tasks.filter((t) => t.state !== "need" && stageOf(t) === stage).length;
  const asks = waiting ? `${waiting} ${waiting === 1 ? "waits" : "wait"} for you` : "nothing waits for you";
  const working = tasks.filter((t) => t.state === "work").length;
  const planning = now.planning ?? 0;
  return {
    you: {
      text: waiting ? `${waiting} to decide` : "nothing to decide",
      you: waiting > 0,
      live: waiting > 0,
      beat: waiting,
    },
    dispatcher: {
      text: now.sending ? "reading your request" : `${projects.length} ${projects.length === 1 ? "project" : "projects"}`,
      live: !!now.sending,
      beat: now.sends ?? 0,
    },
    planner: {
      text: planning ? `laying the steps of ${planning} ${planning === 1 ? "request" : "requests"}` : "no request to plan",
      live: planning > 0,
      beat: planning,
    },
    rules: {
      text: `${at("queued")} in line`,
      live: at("queued") > 0,
      beat: tasks.filter((t) => stageOf(t) !== "queued").length,
    },
    // as the answer counts them: every task at work, the ones in review and ready to merge too
    worker: { text: `${working} at work`, live: working > 0, beat: working },
    reviewer: {
      text: `${at("review")} checking`,
      live: at("review") > 0,
      beat: at("review"),
    },
    inbox: { text: asks, you: waiting > 0, live: waiting > 0, beat: waiting },
  };
}
