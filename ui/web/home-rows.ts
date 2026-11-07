import { type AgentRow, agentStatus } from "../../src/agent-status.ts";
import type { InboxItem, Project, Task } from "../kit/index.ts";
import type { HomeData } from "./data.ts";

export interface Row extends AgentRow {
  stuck: boolean;
  last?: Task["last"];
  task: Task;
  /** The ask this task waits on, shown in its open row. */
  ask?: InboxItem;
}

/** The rows of `agentStatus`, each with what the open row needs of its task. */
export function rowsOf(projects: Project[], loose: HomeData["loose"], host: string, asks: InboxItem[] = [], now = Date.now()): Row[] {
  const tasks = new Map([...projects.flatMap((p) => p.tasks), ...(loose ?? [])].map((t) => [t.id, t]));
  return agentStatus(projects, loose, host, now).flatMap((r) => {
    const t = tasks.get(r.id);
    return t ? [{ ...r, stuck: t.state === "need" || !!t.stalled, last: t.last, task: t, ask: asks.find((a) => a.task === t.id) }] : [];
  });
}
