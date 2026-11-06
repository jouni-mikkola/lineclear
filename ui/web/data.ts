import type { TaskDetail } from "../../src/task-detail.ts";
import { QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { AccountUse, MonthSpend, Browser, Detection, InboxItem, Move, NewProject, Project, Repo, Started, Task } from "../kit/index.ts";
import type { RoadmapData } from "../../src/roadmap-view.ts";
import type { StepRecord } from "../../src/step-page.ts";
import { browserSamples } from "./browser-samples.ts";
import type { AppliedChange, PlanCard } from "../../src/web.ts";
import type { CompactionGauge } from "../../src/compaction-gauge.ts";
import { ApiError, forget, startRead } from "./health.ts";
import { noteRevision, useStreamed, watch } from "./live.ts";
import { emptyRoadmap, roadmapSample, stepSample } from "./roadmap-samples.ts";
import { lazySamples } from "./lazy-samples.ts";
import { emptySettings } from "./settings-empty.ts";
import type { SettingsData } from "./settings-empty.ts";
import { CHAT_STATES, compaction, detected, inbox, moves, type PageState, projects, sampleRepos, spend, STATES, usage } from "./samples.ts";

const SAMPLE_MONTH: MonthSpend = {
  month: "2026-01",
  paid: [{ amount: 120, currency: "USD" }],
  paidUnknown: true,
  apiEquivalent: 612.4,
  accounts: [
    { account: "anthropic", kind: "subscription", paid: { amount: 100, currency: "USD" }, apiEquivalent: 540.1 },
    { account: "openai", kind: "subscription", apiEquivalent: 52.3 },
    { account: "openrouter", kind: "key", paid: { amount: 20, currency: "USD" }, apiEquivalent: 20 },
  ],
};

// What the views read: the server's `/api/home`, `/api/inbox`, `/api/roadmap/<project>` and `/api/browsers`, read again every few seconds and when the page
// shows again. `?state=` draws a sample state instead, so each state can be seen and tested.

export interface HomeData {
  projects: Project[];
  /** This machine's name: the machine of a task that names none. */
  host?: string;
  /** Open tasks of spaces no project points at, so no running work hides. */
  loose?: (Task & { space: string })[];
  /** Spend and usage come once the server has read them: the charts load until then. */
  spend?: { day: string; dollars: number }[];
  usage?: AccountUse[];
  /** This calendar month: paid and at API prices. */
  month?: MonthSpend;
  moves?: Move[];
  /** The Dispatcher works on an answer now. */
  dispatcher?: { writing: boolean };
  /** How many requests the Planner is laying steps for now. */
  planning?: number;
  /** Compactions, their fallbacks and tokens per merged task, of the last 14 days. */
  compaction?: CompactionGauge;
  /** The waste watch's standing alarms, one line each. */
  waste?: string[];
  herdr?: string[];
  /** What `lineclear doctor` finds wrong, each with its fix command. */
  doctor?: string[];
}

/** `offline` is when the server last answered, while a later read fails. */
export type Load<T> = { status: "loading" } | { status: "error"; error: string; retry: () => void } | { status: "ok"; data: T; offline?: number };

export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchInterval: 1500, staleTime: 0, networkMode: "always" } } });

/** The sample state named by `?state=`, if any. */
export function sampleState(): PageState | undefined {
  const s = new URLSearchParams(location.search).get("state") ?? "";
  // a state only the Chat view has draws the other views filled
  if ((CHAT_STATES as readonly string[]).includes(s) && !(STATES as readonly string[]).includes(s)) return "filled";
  return (STATES as readonly string[]).includes(s) ? (s as PageState) : undefined;
}

/** The time the offline sample says it last read. */
export const SAMPLE_OFFLINE = Date.UTC(2026, 9, 31, 11, 42);

/** What each view needs of an answer to draw at all; a deeper fault is the view's error boundary's to catch. */
export const isList = (d: unknown) => Array.isArray(d) && d.every((x) => typeof x === "object" && x !== null);
export const hasLists =
  (...keys: string[]) =>
  (d: unknown) =>
    typeof d === "object" && d !== null && keys.every((k) => Array.isArray((d as Record<string, unknown>)[k]));

export async function get<T>(path: string, fits: (data: unknown) => boolean = () => true): Promise<T> {
  const read = startRead(path);
  try {
    let r: Response;
    try {
      const early = path === "/api/home" ? (window as { __early?: Promise<Response> }).__early : undefined;
      if (early) (window as { __early?: Promise<Response> }).__early = undefined;
      r = await (early ?? fetch(path, { headers: { accept: "application/json" } }));
    } catch {
      throw navigator.onLine ? new ApiError("The server did not answer: it is not running.", "stopped") : new ApiError("There is no connection.", "lost");
    }
    if (!r.ok) {
      // the server's own reason, with its lines, such as the errors of a roadmap that does not pass its check
      const body = (await r.json().catch(() => ({}))) as { error?: unknown; lines?: unknown; file?: unknown };
      const lines = Array.isArray(body.lines) ? body.lines.map(String) : undefined;
      const kind = [502, 503, 504].includes(r.status) ? "stopped" : lines && typeof body.file === "string" ? "broken" : "stale";
      const message = typeof body.error === "string" ? [body.error, ...(lines ?? [])].join("\n") : `${path} answered ${r.status}.`;
      throw new ApiError(message, kind, typeof body.file === "string" ? body.file : undefined, lines);
    }
    const data: unknown = await r.json().catch(() => undefined);
    if (!fits(data)) throw new ApiError(`${path} gave an answer this page cannot read.`, "stale");
    const shown = noteRevision(path, r.headers.get("x-live-rev"), data as T);
    read.ok();
    return shown;
  } catch (e) {
    const error = e instanceof ApiError ? e : new ApiError(String(e), "stale");
    read.fail(error);
    throw error;
  }
}

function sample<T>(state: PageState, filled: () => T, empty: T): Load<T> {
  if (state === "loading") return { status: "loading" };
  if (state === "error") return { status: "error", error: "The server did not answer: connection refused.", retry: () => location.reload() };
  return { status: "ok", data: state === "empty" ? empty : filled(), ...(state === "offline" ? { offline: SAMPLE_OFFLINE } : {}) };
}

export function useLoad<T>(
  key: string | string[],
  path: string,
  state: PageState | undefined,
  filled: (state: PageState) => T,
  empty: T,
  on = true,
  fits?: (data: unknown) => boolean,
  every?: number,
): Load<T> {
  const asked = !state && on;
  const queryKey = Array.isArray(key) ? key : [key];
  const streamed = useStreamed(path, asked);
  // the stream carries the changes: a view polls only while it does not
  const q = useQuery({
    queryKey,
    queryFn: () => get<T>(path, fits),
    enabled: asked,
    ...(streamed ? { refetchInterval: false, staleTime: Infinity } : every ? { refetchInterval: every } : {}),
  });
  useEffect(() => (asked ? watch(queryClient, path, queryKey) : undefined), [asked, path, queryKey.join()]);
  useEffect(() => {
    if (!asked) forget(path);
    return () => forget(path);
  }, [asked, path]);
  if (state) return sample(state, () => filled(state), empty);
  // what was read stays on screen while a later read fails
  if (q.data !== undefined) return { status: "ok", data: q.data, ...(q.isError ? { offline: q.dataUpdatedAt } : {}) };
  if (q.isError) return { status: "error", error: q.error.message, retry: () => void q.refetch() };
  return { status: "loading" };
}

export const useHome = (state: PageState | undefined) =>
  useLoad<HomeData>(
    "home",
    "/api/home",
    state,
    (s) => ({
      projects: projects(s),
      spend,
      usage: usage(s),
      month: SAMPLE_MONTH,
      moves,
      compaction: compaction(s),
      ...(s === "many" ? { waste: ["Waste: step started again and again, 146 starts of a T2"] } : {}),
    }),
    { projects: [], spend: [], usage: [], compaction: { compactions: 0, fellBack: 0, tokensPerTask: null, tasks: 0 } },
    true,
    (d) => hasLists("projects")(d) && (d as HomeData).projects.every((p) => typeof p?.name === "string" && Array.isArray(p.tasks)),
  );

/** A project's roadmap, read only while its view shows. */
export const useRoadmap = (project: string, state: PageState | undefined, on: boolean) =>
  useLoad<RoadmapData>(
    ["roadmap", project],
    `/api/roadmap/${encodeURIComponent(project)}`,
    state,
    (s) => roadmapSample(s, project),
    emptyRoadmap(project),
    on,
    hasLists("phases", "steps"),
  );

/** One step's checklist, waits and history, read only while its page shows. */
export const useStepRecord = (project: string, step: string | undefined, state: PageState | undefined) =>
  useLoad<StepRecord>(
    ["step", project, step ?? ""],
    `/api/roadmap/${encodeURIComponent(project)}/step/${encodeURIComponent(step ?? "")}`,
    state,
    (s) => stepSample(roadmapSample(s, project), step ?? ""),
    { step: step ?? "", checklist: [], waits: [], read: [] },
    step !== undefined,
    (d) => hasLists("checklist", "waits", "read")(d),
  );

/** The agents' open browsers, read every 1.5 s so a finished task's browser leaves within 3 s. Only their own view asks the server for a fresh list: reading it costs a process. */
export const useBrowsers = (state: PageState | undefined, live: boolean) =>
  useLoad<Browser[]>("browsers", live ? "/api/browsers?live" : "/api/browsers", state, () => browserSamples(state as PageState), [], true, isList, 1500);

const SAMPLE_DETAIL: TaskDetail = {
  log: ["Read the cart code.", "Wrote the retry test first.", "Tests pass; running the check."],
  diff: " src/cart.ts | 14 ++++++++------\n test/cart.test.ts | 22 ++++++++++++++++++++++\n 2 files changed, 30 insertions(+), 6 deletions(-)",
  check: { ok: true, command: "bun run check", seconds: 96, at: Date.UTC(2026, 9, 31, 11, 40), failed: [] },
  review: ["minor: name the helper for what it returns."],
  cost: 1.84,
};
export const useTaskDetail = (id: string, state: PageState | undefined) =>
  useLoad<TaskDetail>(
    ["task", id],
    `/api/task/${encodeURIComponent(id)}`,
    state,
    () => SAMPLE_DETAIL,
    { log: [], diff: "", review: [] },
    true,
    (d) => typeof d === "object" && d !== null && Array.isArray((d as TaskDetail).log),
    5000,
  );

/** Takes a browser over, gives it back, or sends it one input. Resolves to the server's reason when it fails. */
export const drive = (session: string, what: "take" | "input", body: unknown) => send(`/api/browsers/${encodeURIComponent(session)}/${what}`, body);

/** The plans started with `lineclear plan`, read only while a view shows one. */
export const usePlans = (state: PageState | undefined, on: boolean) =>
  useLoad<PlanCard[]>("plans", "/api/plans", state, () => lazySamples?.chat.planSamples("request") ?? [], [], on, isList);

/** The changes that applied by themselves in a project, with their undo. A sample page has none. */
export const useApplied = (project: string, state: PageState | undefined) =>
  useLoad<AppliedChange[]>(["applied", project], `/api/applied/${encodeURIComponent(project)}`, state, () => [], [], true, isList);

export const useInbox = (state: PageState | undefined) => useLoad<InboxItem[]>("inbox", "/api/inbox", state, () => inbox(state as PageState), [], true, isList);

/**
 * Answers an Inbox item. It leaves the list at once; when the answer fails it comes back with the reason.
 */
export function useAnswer(state: PageState | undefined) {
  const client = useQueryClient();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const answer = async (item: InboxItem, choice: string, note?: string) => {
    setGone((g) => new Set(g).add(item.id));
    setErrors(({ [item.id]: _, ...rest }) => rest);
    if (state) return;
    const error = await send(`/api/inbox/${item.id}`, { choice, note });
    if (error) {
      setErrors((e) => ({ ...e, [item.id]: error }));
      setGone((g) => {
        const n = new Set(g);
        n.delete(item.id);
        return n;
      });
    }
    await client.invalidateQueries({ queryKey: ["inbox"] });
  };
  return { gone, errors, answer };
}

/** Machines and each project's settings, read only while Settings shows. */
export const useSettings = (state: PageState | undefined, on: boolean) =>
  useLoad<SettingsData>(
    "settings",
    "/api/settings",
    state,
    () => lazySamples?.settings.settingsSample(state as PageState) ?? emptySettings,
    emptySettings,
    on,
    hasLists("machines", "projects"),
  );

type Answer<T> = { ok: true; data: T } | { ok: false; error: string };

/** One call to the server: the answer, or the server's reason when it fails. */
async function call<T>(path: string, init?: RequestInit): Promise<Answer<T>> {
  try {
    const r = await fetch(path, { ...init, headers: { accept: "application/json", ...init?.headers } });
    const data = (await r.json().catch(() => ({}))) as T & { error?: string };
    return r.ok ? { ok: true, data } : { ok: false, error: data.error ?? `The server answered ${r.status}.` };
  } catch {
    return { ok: false, error: "The server did not answer. Try again." };
  }
}

/** Posts JSON to the server. The one way the pages write. */
export const post = <T = unknown>(path: string, body: unknown) =>
  call<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** Sends one change to the server. Resolves to the server's reason when it fails. */
export async function send(path: string, body: unknown): Promise<string | undefined> {
  const r = await post(path, body);
  return r.ok ? undefined : r.error;
}

/** What `lineclear project add` finds in a folder. On a sample page, the same sample for every folder. */
export async function detect(repo: string, sample: boolean): Promise<Detection | { error: string }> {
  if (sample) return detected(repo);
  const r = await call<Detection>(`/api/detect?repo=${encodeURIComponent(repo)}`);
  return r.ok ? r.data : { error: r.error };
}

/** The git repos in the home's usual folders that are no project yet. On a sample page, two samples. */
export async function findRepos(sample: boolean): Promise<Repo[]> {
  if (sample) return sampleRepos;
  const r = await call<{ repos?: Repo[] }>("/api/repos");
  return r.ok ? (r.data.repos ?? []) : [];
}

/** Starts a project as the CLI adds one, with its first roadmap when it has none. Resolves to the server's reason when it fails. */
export async function addProject(p: NewProject, sample: boolean): Promise<Started> {
  if (sample) return { planning: false };
  const r = await post<{ planning?: boolean }>("/api/projects", p);
  return r.ok ? { planning: !!r.data.planning } : { error: r.error };
}
