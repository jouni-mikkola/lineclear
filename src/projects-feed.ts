import { type HomeData, type HomeProject, projectsData } from "./home-data.ts";
import { listProjectNames, readSettings } from "./project.ts";
import type { Env } from "./web-guard.ts";

/** A project's roadmap link: its Lineclear project, which is the one that has its space. */
function withRoadmap(p: HomeProject, spaces: Map<string, string>): HomeProject {
  const own = !p.space || p.machine ? undefined : spaces.get(p.space);
  return own ? { ...p, roadmap: own } : p;
}

/** Each Lineclear project by its Lineclear space, so Home can link a project to its roadmap. */
function roadmapsBySpace(env: Env): Map<string, string> {
  const by = new Map<string, string>();
  for (const name of listProjectNames(env)) {
    const s = readSettings(name, env);
    if (typeof s !== "string" && !by.has(s.space)) by.set(s.space, name);
  }
  return by;
}

/** Every space with its tasks and its roadmap link. Reading it runs git and lineclear and blocks: never on the web's thread. */
export function readProjects(env: Env, t: number): HomeData["projects"] {
  const spaces = roadmapsBySpace(env);
  return projectsData(env, t).map((p) => withRoadmap(p, spaces));
}

export interface ProjectsFeed {
  /** The last snapshot at once, undefined before the first. */
  now(): HomeData["projects"] | undefined;
  /** The last snapshot, or the first one when it is not there yet; it fails when the first read does. */
  ready(): Promise<HomeData["projects"]>;
  /** Asks for a read now, after a change: callers keep the last snapshot until it is there. */
  refresh(): void;
  stop(): void;
}

type Message = { projects: HomeData["projects"] } | { error: string };

const WORKER = new URL("./projects-worker.ts", import.meta.url).href;

/**
 * The projects, read again and again in a worker thread of their own and published as snapshots, so a request
 * never waits on a read. The worker lives as long as the feed, so what it remembers (when a task was first seen at its stage, the git
 * memos) lasts too.
 */
export function projectsFeed(env: Env, every = 1_000, script = WORKER): ProjectsFeed {
  let snapshot: HomeData["projects"] | undefined;
  const waiting: { resolve: (v: HomeData["projects"]) => void; reject: (e: Error) => void }[] = [];
  const fail = (message: string) => {
    for (const w of waiting.splice(0)) w.reject(new Error(message));
  };
  const worker = new Worker(script, { env: env as Record<string, string> });
  worker.postMessage({ every });
  worker.onmessage = (e: MessageEvent<Message>) => {
    if ("error" in e.data) {
      console.error(`lineclear: a projects read failed: ${e.data.error}`);
      if (snapshot === undefined) fail(e.data.error);
      return;
    }
    snapshot = e.data.projects;
    for (const w of waiting.splice(0)) w.resolve(e.data.projects);
  };
  worker.onerror = (e) => {
    console.error(`lineclear: the projects worker failed: ${e.message}`);
    fail(e.message);
  };
  return {
    now: () => snapshot,
    ready: async () => snapshot ?? new Promise((resolve, reject) => waiting.push({ resolve, reject })),
    refresh: () => worker.postMessage({ now: true }),
    stop: () => void worker.terminate(),
  };
}
