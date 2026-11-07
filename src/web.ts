import { browsers } from "./browsers.ts";
import type { HomeData } from "./home-data.ts";
import { type ProjectsFeed, projectsFeed, readProjects as readProjectsNow } from "./projects-feed.ts";
import type { RoadmapRead } from "./roadmap-view.ts";
import { type Aside, type Kept, keptAside, readAside } from "./read-aside.ts";
import { type Pusher, pushOnChange, watchInboxFolder } from "./notify.ts";
import { dispatcherChat, taskChatLinks } from "./chat.ts";
import { taskTerminalLinks } from "./task-live.ts";
import { apiAnswer, liveHub } from "./live.ts";
import { webResponse } from "./web-files.ts";
import { webAddress } from "./web-address.ts";
import { type Env, fail, knownHost, PAGE_TOKEN, TOKEN_COOKIE } from "./web-guard.ts";
import type { Ctx } from "./web-ctx.ts";
import { route } from "./web-routes.ts";

export { knownHost, PAGE_TOKEN };
export type { AppliedChange, PlanCard } from "./web-views.ts";

/**
 * The data the views read, with no AI, as one handler of `Request`: the routes are in web-routes.ts and listed in
 * docs/api.md. Projects are read again at most once a second. The slow reads run aside, in a process of
 * their own, and answer with the last value while a new one is read: each roadmap at most once a second (one older than
 * a minute is waited for). A POST must be JSON from this server's own pages.
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
  const roadmap = (name: string) => {
    let k = roadmaps.get(name);
    if (!k) {
      const read = async () => {
        const r = (await aside("roadmap", name)) as RoadmapRead;
        // a name with no project is not kept, so asking for many names does not grow the cache
        if (!("ok" in r) && r.status === 404) roadmaps.delete(name);
        return r;
      };
      roadmaps.set(name, (k = keptAside(read, 1_000, now)));
    }
    return k;
  };
  let chat: ReturnType<typeof dispatcherChat> | undefined;
  const ctx: Ctx = {
    env,
    now,
    aside,
    push,
    // Home and the Inbox read the tasks from the same copy: reading them runs lineclear and git, so a server with a feed
    // takes them from the feed's thread and never waits; one without reads them here, once a second (tests)
    readProjects: async (t) => {
      if (feed) return feed.ready();
      if (!projects || t - projects.at > 1_000) projects = { at: t, data: readProjectsNow(env, t) };
      return projects.data;
    },
    forgetProjects: () => {
      projects = undefined;
      feed?.refresh();
    },
    forgetRoadmap: (name) => roadmaps.delete(name),
    roadmap,
    warmed: new Set<string>(),
    live: browsers(env, now),
    dispatcher: () =>
      (chat ??= dispatcherChat(
        env,
        undefined,
        undefined,
        setup ? async () => ((await aside("dispatcher").catch(() => ({ code: 1 }))) as { code: number }).code : undefined,
      )),
    taskChats: taskChatLinks(env),
    taskTerminals: taskTerminalLinks(env),
  };
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    return knownHost(url.hostname, env) ? route(ctx, req, url) : unknownHost(url);
  };
}

const unknownHost = (url: URL) => fail(`${url.hostname} is not a name of this server. Add it to LINECLEAR_HOSTS.`, 403);

/** The built pages and their data as a handler, with what it watches. `stop` ends the feed and the watchers. */
export function webHandler(dir: string, env: Env = process.env, push?: Promise<Pusher>, feed?: ProjectsFeed) {
  // a test run (it sets LINECLEAR_DOCTOR_FILE) serves fixed data and never changes the machine it runs on
  const real = env.LINECLEAR_DOCTOR_FILE === undefined;
  const projects = feed ?? (real ? projectsFeed(env) : undefined);
  const api = webApi(env, () => Date.now(), readAside(env), push, real, projects);
  const live = liveHub(api, "/api/home"); // the slow reads start with the server, so the first page finds them done
  // an Inbox item written or closed reaches the open pages in about 3 s at most, not at the next beat of their stream; the api keeps what it read for a second, so the views are read after that
  let changed: ReturnType<typeof setTimeout> | undefined;
  // each new Inbox item reaches the devices that allowed alerts
  let tellNew: (() => void) | undefined;
  const unwatchFolder = watchInboxFolder(env, () => {
    tellNew?.();
    clearTimeout(changed);
    changed = setTimeout(live.refresh, 1100);
  });
  void push?.then(
    (p) => (tellNew = pushOnChange(p, env as NodeJS.ProcessEnv)),
    (e) => console.error(`lineclear: no push: ${(e as Error).message}`),
  );
  return {
    fetch: async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      if (url.pathname.startsWith("/api/")) return apiAnswer(live, api, req, url, knownHost(url.hostname, env));
      // a name this server does not know gets no page and no token
      if (!knownHost(url.hostname, env)) return unknownHost(url);
      const res = webResponse(dir, req.url, req.headers.get("accept-encoding") ?? "");
      if (res.headers.get("content-type")?.startsWith("text/html")) res.headers.append("set-cookie", `${TOKEN_COOKIE}=${PAGE_TOKEN}; Path=/; SameSite=Strict`);
      return res;
    },
    stop() {
      tellNew = undefined;
      unwatchFolder();
      clearTimeout(changed);
      projects?.stop();
    },
  };
}

/** Serves the built pages and their data on a port of their own: the demo and tests. The real server mounts `webHandler` in the board's. */
export function serveWeb(dir: string, address = webAddress(), env: Env = process.env, push?: Promise<Pusher>, feed?: ProjectsFeed) {
  const web = webHandler(dir, env, push, feed);
  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({ ...address, fetch: web.fetch });
  } catch (e) {
    // a port in use must not leave the feed's thread reading
    web.stop();
    throw e;
  }
  const stop = server.stop.bind(server);
  server.stop = (force?: boolean) => {
    web.stop();
    return stop(force);
  };
  return server;
}
