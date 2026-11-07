import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { browsers } from "./browsers.ts";
import type { HomeData } from "./home-data.ts";
import { type ProjectsFeed, projectsFeed, readProjects as readProjectsNow } from "./projects-feed.ts";
import type { RoadmapRead } from "./roadmap-view.ts";
import { type Aside, readAside } from "./read-aside.ts";
import { type Pusher, realPush, watchInbox } from "./notify.ts";
import { dispatcherChat, taskChatLinks } from "./chat.ts";
import { taskTerminalLinks } from "./task-live.ts";
import { apiAnswer, liveHub } from "./live.ts";
import { WEB_DIST, WEB_ROOT, webResponse } from "./web-files.ts";
import { configDir } from "../pi/config.ts";
import { webAddress } from "./web-address.ts";
import { type Env, json, knownHost, PAGE_TOKEN, TOKEN_COOKIE } from "./web-guard.ts";
import { type Ctx, route } from "./web-routes.ts";

export { knownHost, PAGE_TOKEN };
export type { AppliedChange, PlanCard } from "./web-views.ts";

interface Kept<T> {
  /** The last value at once, undefined before the first; a new read starts when it is old. */
  now(): T | undefined;
  /** The same, but it waits for a new read when there is no value yet, or the last one is older than `wait` ms. */
  ready(wait?: number): Promise<T | undefined>;
}

/** A value read by `read` and kept for `ms`. One read runs at a time, and a failed read keeps the last value. */
function keptAside<T>(read: () => Promise<T>, ms: number, now: () => number): Kept<T> {
  let value: T | undefined;
  let at = -Infinity;
  let reading: Promise<T | undefined> | undefined;
  const refresh = () =>
    (reading ??= read()
      .then(
        (v) => (value = v),
        (e) => (console.error(`lineclear: a read failed: ${(e as Error).message}`), value),
      )
      .finally(() => {
        at = now();
        reading = undefined;
      }));
  const get = () => {
    if (now() - at > ms) void refresh();
    return value;
  };
  return { now: get, ready: async (wait = Infinity) => (value === undefined || now() - at > wait ? refresh() : get()) };
}

/**
 * The data the views read, with no AI: `GET /api/home`, `GET /api/roadmap/<project>`, `GET /api/inbox` (what waits for you: open items newest first, then waiting tasks) and
 * `POST /api/inbox/<n>` with `{"choice": "...", "note": "..."}` to answer one (the note is a plan's reason to reject).
 * `GET /api/browsers` lists the agents' open browser sessions and `GET /api/browsers/<session>/picture` is a live
 * picture of one (`?size=thumb` a small one for a card, served from memory); `POST /api/browsers/<session>/take` with `{"take": true}` takes one over (false gives it back),
 * and `POST /api/browsers/<session>/input` sends a click, text, a key or a scroll to one taken over.
 * `GET /api/detect?repo=<folder>` gives what `lineclear project add` finds in a folder and `POST /api/projects` with
 * `{repo, name, space, check, models}` saves it where the CLI does.
 * `GET /api/setup` gives the harnesses and accounts found and the model chosen per role, and `POST /api/setup` saves a choice where `lineclear setup` does.
 * `GET /api/settings` gives each project's settings with its secret names,
 * never their values. `POST /api/projects/<name>` changes a project's commands, Running or Paused (`{"paused": true}`), or the
 * order of a role's models, in the files the CLI writes.
 * `GET /api/chat/events` streams the Dispatcher's chat as server-sent events, `POST /api/chat` with
 * `{"text": "...", "files": [ids], "cid": "..."}` sends it a message, `POST /api/chat/files` with `{"name": "...", "data": base64}` attaches a
 * file through Lineclear and gives its id, `GET /api/chat/file?path=` reads a file of the chat from Lineclear, and
 * `GET /api/chat/image?path=` shows an image the Dispatcher names from its own folders. `POST /api/chat/answer` with
 * `{"question": id, "choice": n}` answers a card the Dispatcher asked with. `/api/task/<id>/chat` and its `/events`, `/file`, `/image`, `/files`, `/answer`, `/react` are the same for the chat of one task with its agent. `GET /api/plans` lists each plan started
 * with `lineclear plan`, newest first: its goal, where it stands, the steps it adds, and its open Inbox item.
 * Projects are read again at most once a second. The slow reads run aside, in a process of their own, and answer
 * with the last value while a new one is read: each roadmap at most once a second (one older than a minute is waited
 * for). A POST must be JSON from this server's own pages.
 */
export function webApi(
  env: Env = process.env,
  now = () => Date.now(),
  aside: Aside = readAside(env),
  push?: Promise<Pusher>,
  setup = false,
  feed?: ProjectsFeed,
) {
  let projects: { at: number; data: HomeData["projects"] } | undefined;
  const roadmaps = new Map<string, Kept<RoadmapRead>>();
  const warmed = new Set<string>();
  const roadmap = (name: string) => {
    let k = roadmaps.get(name);
    if (!k) {
      k = keptAside(
        async () => {
          const read = (await aside("roadmap", name)) as RoadmapRead;
          // a name with no project is not kept, so asking for many names does not grow the cache
          if (!("ok" in read) && read.status === 404) roadmaps.delete(name);
          return read;
        },
        1_000,
        now,
      );
      roadmaps.set(name, k);
    }
    return k;
  };
  // Home and the Inbox read the tasks from the same copy: reading them runs lineclear and git, so a server with a feed
  // takes them from the feed's thread and never waits; one without reads them here, once a second (tests, the demo)
  const readProjects = async (t: number) => {
    if (feed) return feed.ready();
    if (!projects || t - projects.at > 1_000) projects = { at: t, data: readProjectsNow(env, t) };
    return projects.data;
  };
  const live = browsers(env, now);
  let chat: ReturnType<typeof dispatcherChat> | undefined;
  const dispatcher = () =>
    (chat ??= dispatcherChat(
      env,
      undefined,
      undefined,
      setup ? async () => ((await aside("dispatcher").catch(() => ({ code: 1 }))) as { code: number }).code : undefined,
    ));
  const taskChats = taskChatLinks(env);
  const taskTerminals = taskTerminalLinks(env);

  const ctx: Ctx = {
    env,
    now,
    aside,
    push,
    readProjects,
    forgetProjects: () => {
      projects = undefined;
      feed?.refresh();
    },
    forgetRoadmap: (name) => roadmaps.delete(name),
    roadmap,
    warmed,
    live,
    dispatcher,
    taskChats,
    taskTerminals,
  };
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (!knownHost(url.hostname, env)) return json({ error: `${url.hostname} is not a name of this server. Add it to LINECLEAR_HOSTS.` }, 403);
    return route(ctx, req, url);
  };
}

/**
 * Calls `onChange` once a second at most when the Inbox folder changes: an item written or closed replaces a file, which
 * moves the folder's time. One stat of the folder is the whole cost, and a folder removed and made again is noticed too.
 * Returns a function that stops it.
 */
function watchInboxFolder(env: Env, onChange: () => void): () => void {
  const dir = join(configDir(env as NodeJS.ProcessEnv), "inbox");
  const stamp = () => {
    try {
      const s = statSync(dir);
      return `${s.ino}:${s.mtimeMs}`;
    } catch {
      return "";
    }
  };
  let seen = stamp();
  const timer = setInterval(() => {
    const now = stamp();
    if (now === seen) return;
    seen = now;
    onChange();
  }, 1000);
  return () => clearInterval(timer);
}

/** Serves the built pages and their data. */
export function serveWeb(dir: string, address = webAddress(), env: Env = process.env, push?: Promise<Pusher>, feed?: ProjectsFeed) {
  // a demo or a test run (it sets LINECLEAR_DOCTOR_FILE) serves fixed data and never changes the machine it runs on
  const real = env.LINECLEAR_DOCTOR_FILE === undefined;
  const projects = feed ?? (real ? projectsFeed(env) : undefined);
  const api = webApi(env, () => Date.now(), readAside(env), push, real, projects);
  const live = liveHub(api, "/api/home"); // the slow reads start with the server, so the first page finds them done
  // an Inbox item written or closed reaches the open pages in about 3 s at most, not at the next beat of their stream; the api keeps what it read for a second, so the views are read after that
  let changed: ReturnType<typeof setTimeout> | undefined;
  const unwatchFolder = watchInboxFolder(env, () => {
    clearTimeout(changed);
    changed = setTimeout(live.refresh, 1100);
  });
  // each new Inbox item reaches the devices that allowed alerts
  let unwatch: (() => void) | undefined;
  void push?.then(
    (p) => (unwatch = watchInbox(p, env as NodeJS.ProcessEnv)),
    (e) => console.error(`lineclear: no push: ${(e as Error).message}`),
  );
  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      ...address,
      fetch: async (req) => {
        const url = new URL(req.url);
        if (url.pathname.startsWith("/api/")) {
          return apiAnswer(live, api, req, url, knownHost(url.hostname, env));
        }
        // a name this server does not know gets no page and no token
        if (!knownHost(url.hostname, env)) return json({ error: `${url.hostname} is not a name of this server. Add it to LINECLEAR_HOSTS.` }, 403);
        const res = webResponse(dir, req.url, req.headers.get("accept-encoding") ?? "");
        if (res.headers.get("content-type")?.startsWith("text/html"))
          res.headers.append("set-cookie", `${TOKEN_COOKIE}=${PAGE_TOKEN}; Path=/; SameSite=Strict`);
        return res;
      },
    });
  } catch (e) {
    // a port in use must not leave the feed's thread reading
    projects?.stop();
    throw e;
  }
  const stop = server.stop.bind(server);
  server.stop = (force?: boolean) => {
    unwatch?.();
    unwatchFolder();
    clearTimeout(changed);
    projects?.stop();
    return stop(force);
  };
  return server;
}

/** Serves the built web pages beside the loop. Without them it says how to build them and the rules run on. */
export async function startWeb(out: (l: string) => void) {
  if (!existsSync(join(WEB_DIST, "index.html"))) {
    console.error(`lineclear run: no web pages: they are not built. Run: cd ${dirname(dirname(WEB_ROOT))} && bun run web:build`);
    return undefined;
  }
  try {
    // the push code is loaded first: while it loads, LINECLEAR_HOME is set, and nothing that copies the environment may start before that ends
    const push = realPush();
    await push.catch(() => undefined);
    const server = serveWeb(WEB_DIST, undefined, process.env, push);
    out(`lineclear run: web pages at http://${server.hostname}:${server.port}/`);
    return { stop: () => void server.stop(true) };
  } catch (e) {
    console.error(`lineclear run: no web pages: ${e instanceof Error ? e.message : e}`);
    return undefined;
  }
}
