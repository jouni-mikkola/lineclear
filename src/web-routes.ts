import { detectProject, findRepos, saveProject } from "./add-project.ts";
import type { browsers } from "./browsers.ts";
import type { dispatcherChat } from "./chat.ts";
import { setPrice, setRetired } from "./full.ts";
import { readPrefs, setShowPaused, shownProjects } from "./prefs.ts";
import { type HomeData, type HomeProject, looseTasks, type PiSpend, usageData, withProject } from "./home-data.ts";
import { undoApplied } from "./autoplan.ts";
import { inboxMain } from "./inbox-answer.ts";
import { projectDecisions, readItems } from "./inbox.ts";
import { installMachine, type machinesView, removeMachine } from "./machines.ts";
import { HOST, readMachines } from "./machine-list.ts";
import { lineclearDir, worktreeCost } from "./measure.ts";
import type { Pusher } from "./notify.ts";
import type { Aside } from "./read-aside.ts";
import { type AskBefore, changeSettings, listProjectNames, type Role, setupRoles } from "./project.ts";
import { readRelease } from "./release.ts";
import { remoteExports, staleRemotes } from "./remotes.ts";
import { harnesses, readRegistry } from "./models.ts";
import { planViews } from "./requests.ts";
import { saveOffered, setupView } from "./setup.ts";
import type { RoadmapRead } from "./roadmap-view.ts";
import { searchAnswer } from "./search.ts";
import { remoteLineclear } from "./ssh.ts";
import { changesReply } from "./task-changes.ts";
import { taskDetailReply } from "./task-detail.ts";
import { taskLiveApi, type taskTerminalLinks } from "./task-live.ts";
import { waitingForYou } from "./waiting.ts";
import { browserApi, chatApi } from "./web-chat-api.ts";
import { type Env, json, ownPage } from "./web-guard.ts";
import { accountSettings, projectSettings, type SettingsData } from "./web-settings.ts";
import { doctorProblems } from "./home-doctor.ts";
import { appliedChanges, inboxView, planCard, waitingView } from "./web-views.ts";

/** What the routes share: the kept reads, the caches a write clears, and the pieces that talk to the machine. */
export interface Ctx {
  env: Env;
  now: () => number;
  aside: Aside;
  push?: Promise<Pusher>;
  pi: { now: () => PiSpend | undefined };
  readProjects: (t: number) => Promise<HomeData["projects"]>;
  forgetProjects: () => void;
  forgetRoadmap: (name: string) => void;
  roadmap: (name: string) => { ready: (wait?: number) => Promise<RoadmapRead | undefined> };
  warmed: Set<string>;
  live: ReturnType<typeof browsers>;
  dispatcher: () => ReturnType<typeof dispatcherChat>;
  taskChats: (id: string) => ReturnType<typeof dispatcherChat>;
  taskTerminals: ReturnType<typeof taskTerminalLinks>;
  machines: ReturnType<typeof machinesView>;
}

type Route = (c: Ctx, req: Request, url: URL) => Response | Promise<Response> | undefined | Promise<Response | undefined>;

const ID = "[A-Za-z0-9_-]{1,40}";
const PROJECT = "[a-z0-9][a-z0-9_-]{0,79}";
const sentence = (text: string) => text[0]?.toUpperCase() + text.slice(1);
const asJson = async (req: Request) => (await req.json().catch(() => ({}))) as Record<string, unknown>;

const browserRoute: Route = (c, req, url) =>
  url.pathname === "/api/browsers" || url.pathname.startsWith("/api/browsers/") ? browserApi(req, url, c.live, c.env) : undefined;

const chatRoute: Route = (c, req, url) =>
  url.pathname === "/api/chat" || url.pathname.startsWith("/api/chat/") ? chatApi(req, url, c.dispatcher, c.env, "/api/chat") : undefined;

const taskChatRoute: Route = (c, req, url) => {
  const task = new RegExp(`^/api/task/(${ID})/chat(/.*)?$`).exec(url.pathname);
  return task ? chatApi(req, url, () => c.taskChats(task[1] ?? ""), c.env, `/api/task/${task[1]}/chat`) : undefined;
};

const taskLiveRoute: Route = (c, req, url) => {
  const live = new RegExp(`^/api/task/(${ID})(/(?:terminal|artifacts)(?:/.*)?)$`).exec(url.pathname);
  return live ? taskLiveApi(req, url, live[1] ?? "", live[2] ?? "", c.taskTerminals, ownPage(req, url, c.env), c.env) : undefined;
};

const changesRoute: Route = (c, req, url) => {
  const changes = new RegExp(`^/api/task/(${ID})/changes$`).exec(url.pathname);
  return req.method === "GET" && changes ? changesReply(changes[1] ?? "", lineclearDir(c.env), json) : undefined;
};

const searchRoute: Route = async (c, req, url) =>
  req.method === "GET" && url.pathname === "/api/search"
    ? json(await searchAnswer(url.searchParams.get("q") ?? "", await c.readProjects(c.now()), listProjectNames(c.env), (n) => c.roadmap(n).ready(60_000)))
    : undefined;

const homeRoute: Route = async (c, req, url) => {
  if (req.method !== "GET" || url.pathname !== "/api/home") return undefined;
  const t = c.now();
  const list = await c.readProjects(t);
  // each roadmap Home can link to is read before it is asked for
  for (const name of [...listProjectNames(c.env), ...list.flatMap((p: HomeProject) => (p.roadmap ? [p.roadmap] : []))]) {
    if (!c.warmed.has(name)) void c.roadmap(name).ready();
    c.warmed.add(name);
  }
  const spent = c.pi.now();
  const release = readRelease(c.env);
  const planning = planViews(c.env).filter((r) => r.state === "planning").length;
  return json({
    projects: shownProjects(withProject(list), readPrefs(c.env as NodeJS.ProcessEnv)),
    loose: looseTasks(list),
    planning,
    dispatcher: { writing: c.dispatcher().view().writing },
    doctor: doctorProblems(c.env, t).map((p) => `${p.problem}: ${p.fix}`),
    ...(release.checked ? { release } : {}),
    ...(spent ? usageData(spent, c.env, t) : {}),
  } satisfies Partial<HomeData>);
};

const detectRoute: Route = (c, req, url) => {
  if (req.method !== "GET" || url.pathname !== "/api/detect") return undefined;
  const found = detectProject(url.searchParams.get("repo") ?? "", c.env);
  return "error" in found ? json(found, 400) : json(found);
};

const reposRoute: Route = (c, req, url) => (req.method === "GET" && url.pathname === "/api/repos" ? json({ repos: findRepos(c.env) }) : undefined);

const addProjectRoute: Route = async (c, req, url) => {
  if (req.method !== "POST" || url.pathname !== "/api/projects") return undefined;
  if (!ownPage(req, url, c.env)) return json({ error: "Projects are added only from Lineclear's own pages." }, 403);
  const r = await saveProject(await asJson(req), c.env);
  if ("error" in r) return json({ error: r.error }, r.status);
  c.forgetProjects();
  return json({ added: r.name, ...(r.planning ? { planning: true } : {}) }, 201);
};

const settingsRoute: Route = (c, req, url) =>
  req.method === "GET" && url.pathname === "/api/settings"
    ? json({
        machines: c.machines(),
        projects: projectSettings(c.env),
        accounts: accountSettings(c.env, c.pi.now()),
        showPaused: readPrefs(c.env as NodeJS.ProcessEnv).showPaused === true,
      } satisfies SettingsData)
    : undefined;

const setupRoute: Route = async (c, req, url) => {
  if (url.pathname !== "/api/setup") return undefined;
  const registry = readRegistry(harnesses(c.env));
  if (req.method === "GET") return json(setupView(registry, c.env));
  if (req.method !== "POST") return undefined;
  if (!ownPage(req, url, c.env)) return json({ error: "Models are chosen only from Lineclear's own pages." }, 403);
  const body = await asJson(req);
  const choice = Object.fromEntries(setupRoles.flatMap((r) => (typeof body[r] === "string" ? [[r, body[r]]] : [])));
  const problem = saveOffered(choice, registry, c.env);
  return problem ? json({ error: `${sentence(problem)}.` }, 400) : json({ saved: true });
};

const accountRoute: Route = async (c, req, url) => {
  const acct = /^\/api\/accounts\/([^/]+)$/.exec(url.pathname);
  if (req.method !== "POST" || !acct) return undefined;
  if (!ownPage(req, url, c.env)) return json({ error: "Prices change only from Lineclear's own pages." }, 403);
  const body = await asJson(req);
  const name = decodeURIComponent(acct[1] ?? "");
  const problem =
    body.retired !== undefined
      ? setRetired(name, body.retired, c.env as NodeJS.ProcessEnv)
      : setPrice(name, body.price, body.currency, c.env as NodeJS.ProcessEnv);
  return problem ? json({ error: `${sentence(problem)}.` }, 400) : json({ saved: name });
};

const prefsRoute: Route = async (c, req, url) => {
  if (req.method !== "POST" || url.pathname !== "/api/prefs") return undefined;
  if (!ownPage(req, url, c.env)) return json({ error: "This changes only from Lineclear's own pages." }, 403);
  const problem = setShowPaused((await asJson(req)).showPaused, c.env as NodeJS.ProcessEnv);
  return problem ? json({ error: `${sentence(problem)}.` }, 400) : json({ saved: true });
};

async function fixLocal(c: Ctx): Promise<Response> {
  const done = (await c.aside("fix").catch(() => ({ code: 1, fixed: [] }))) as { code: number; fixed: string[] };
  c.machines.recheck();
  if (done.code !== 0) return json({ error: `${done.fixed.at(-1) ?? "The fix did not finish."} Try again in a minute.`, fixed: done.fixed }, 500);
  if (!done.fixed.length) return json({ note: "Lineclear cannot fix this by itself. Details says what is wrong.", fixed: [] });
  return json({ fixed: done.fixed });
}

const machinesRoute: Route = async (c, req, url) => {
  if (req.method !== "POST" || url.pathname !== "/api/machines") return undefined;
  if (!ownPage(req, url, c.env)) return json({ error: "Machines change only from Lineclear's own pages." }, 403);
  const body = await asJson(req);
  if (typeof body.remove === "string")
    return removeMachine(body.remove, c.env) ? json({ removed: body.remove }) : json({ error: `There is no machine ${body.remove}.` }, 404);
  if (body.fix === "local") return fixLocal(c);
  const host = typeof body.add === "string" ? body.add.trim() : "";
  if (!HOST.test(host)) return json({ error: "Give an SSH host, such as build-box or me@10.0.0.5." }, 400);
  if (readMachines(c.env).some((m) => m.host === host && m.state === "installing")) return json({ error: `${host} is being installed already.` }, 409);
  // the install takes minutes: it runs on, and the machine's card shows how it goes
  installMachine(host, c.env).catch((e) => console.error(`lineclear: installing ${host} failed: ${(e as Error).message}`));
  return json({ adding: host }, 202);
};

const projectSettingsRoute: Route = async (c, req, url) => {
  const proj = new RegExp(`^/api/projects/(${PROJECT})$`).exec(url.pathname);
  if (req.method !== "POST" || !proj) return undefined;
  if (!ownPage(req, url, c.env)) return json({ error: "Settings change only from Lineclear's own pages." }, 403);
  const body = await asJson(req);
  const change = {
    check: body.check as string | undefined,
    health: body.health as string | undefined,
    models: body.models as Partial<Record<Role, string[]>> | undefined,
    askBefore: body.askBefore as Partial<AskBefore> | undefined,
    paused: body.paused as boolean | undefined,
  };
  const r = changeSettings(proj[1] ?? "", change, c.env as NodeJS.ProcessEnv);
  if (typeof r === "string") return json({ error: `${sentence(r)}.` }, r.startsWith("no project") ? 404 : 400);
  c.forgetProjects();
  return json({ saved: proj[1] });
};

const roadmapRoute: Route = async (c, req, url) => {
  const road = new RegExp(`^/api/roadmap/(${PROJECT})$`).exec(url.pathname);
  if (req.method !== "GET" || !road) return undefined;
  // a roadmap no one looked at for a minute is read again first, so the view never opens on an old one
  const r = await c.roadmap(road[1] ?? "").ready(60_000);
  if (!r) return json({ error: "The roadmap could not be read. Try again." }, 500);
  return "ok" in r
    ? json({ ...r.ok, decisions: projectDecisions(r.ok.project, r.ok.steps, c.env) })
    : json({ error: r.error, ...(r.file ? { file: r.file } : {}), ...(r.lines ? { lines: r.lines } : {}) }, r.status);
};

const stepRoute: Route = async (c, req, url) => {
  if (req.method !== "GET" || !new RegExp(`^/api/roadmap/${PROJECT}/step/[^/]+$`).test(url.pathname)) return undefined;
  const step = decodeURIComponent(url.pathname.slice(13)).replace("/step/", "/");
  const record = (await c.aside("step", step).catch(() => undefined)) as { error?: string; status?: number } | undefined;
  if (!record) return json({ error: "The step could not be read. Try again." }, 500);
  return record.error ? json({ error: record.error }, record.status ?? 500) : json(record);
};

const pushKeyRoute: Route = async (c, req, url) =>
  url.pathname === "/api/push/key" && req.method === "GET" ? json({ key: (await c.push?.catch(() => undefined))?.publicKey ?? null }) : undefined;

const pushSubscribeRoute: Route = async (c, req, url) => {
  if (url.pathname !== "/api/push/subscribe" || req.method !== "POST") return undefined;
  if (!ownPage(req, url, c.env)) return json({ error: "Alerts are allowed only from Lineclear's own pages." }, 403);
  const pusher = await c.push?.catch(() => undefined);
  const b = (await asJson(req)) as { sub?: { endpoint?: unknown; keys?: unknown }; device?: unknown };
  if (!pusher) return json({ error: "Push is not available on this server." }, 503);
  if (typeof b.sub?.endpoint !== "string" || !b.sub.keys || typeof b.device !== "string") return json({ error: "No subscription was given." }, 400);
  pusher.subscribe(b.sub as Parameters<Pusher["subscribe"]>[0], b.device.slice(0, 80));
  return json({ ok: true });
};

const taskDetailRoute: Route = (c, req, url) =>
  req.method === "GET" && url.pathname.startsWith("/api/task/")
    ? taskDetailReply(
        url.pathname.slice("/api/task/".length),
        { lineclear: lineclearDir(c.env), costSoFar: (w) => worktreeCost(w, c.env) },
        c.env,
        c.now(),
        json,
      )
    : undefined;

const plansRoute: Route = (c, req, url) => (req.method === "GET" && url.pathname === "/api/plans" ? json(planViews(c.env).map(planCard)) : undefined);

const inboxRoute: Route = async (c, req, url) => {
  if (req.method !== "GET" || url.pathname !== "/api/inbox") return undefined;
  const w = waitingForYou(c.env, remoteExports(c.env), await c.readProjects(c.now()));
  return json([...w.items.map((i) => inboxView(i, i.machine, i.title, i.result)), ...w.tasks.map((t) => waitingView(t))]);
};

const appliedRoute: Route = (c, req, url) => {
  const applied = new RegExp(`^/api/applied/(${PROJECT})$`).exec(url.pathname);
  return req.method === "GET" && applied ? json(appliedChanges(applied[1] ?? "", c.env)) : undefined;
};

const undoRoute: Route = async (c, req, url) => {
  const undo = /^\/api\/inbox\/(\d+)\/undo$/.exec(url.pathname);
  if (req.method !== "POST" || !undo) return undefined;
  if (!ownPage(req, url, c.env)) return json({ error: "Plans are undone only from Lineclear's own pages." }, 403);
  const item = readItems(c.env as NodeJS.ProcessEnv).find((i) => i.n === Number(undo[1]));
  if (!item) return json({ error: `There is no item ${undo[1]}.` }, 404);
  const problem = undoApplied(item, new Date(), c.env as NodeJS.ProcessEnv);
  if (problem) return json({ error: sentence(problem) + (problem.endsWith(".") ? "" : ".") }, 409);
  c.forgetProjects();
  c.forgetRoadmap(item.project ?? "");
  return json({ undone: item.n });
};

/** The answer to an Inbox item, where it lives: here, or on another machine by its own Lineclear. */
async function answerItem(c: Ctx, n: string, machine: string | undefined, args: string[]): Promise<{ code: number; text: string } | Response> {
  const said: string[] = [];
  let code: number;
  if (machine) {
    if (!readMachines(c.env).some((m) => m.host === machine)) return json({ error: `There is no machine ${machine}.` }, 404);
    const r = await remoteLineclear(machine, ["inbox", "answer", n, ...args], c.env);
    said.push(...r.lines);
    code = r.code === 0 ? 0 : r.code === 2 ? 2 : 1;
    staleRemotes();
  } else code = inboxMain(["answer", n, ...args], (l) => said.push(l), c.env);
  return { code, text: said.join(" ").replace(/^lineclear inbox: /, "") };
}

const answerRoute: Route = async (c, req, url) => {
  const answer = /^\/api\/inbox\/(\d+)(?:@(.+))?$/.exec(url.pathname);
  if (req.method !== "POST" || !answer) return undefined;
  if (!ownPage(req, url, c.env)) return json({ error: "Answers come only from Lineclear's own pages." }, 403);
  const { choice, note } = await asJson(req);
  if (typeof choice !== "string" || !choice) return json({ error: "No answer was given." }, 400);
  const reason = typeof note === "string" && note.trim() ? ["--note", note.trim()] : [];
  const r = await answerItem(c, answer[1] ?? "", answer[2] ? decodeURIComponent(answer[2]) : undefined, [choice, ...reason]);
  if (r instanceof Response) return r;
  c.forgetProjects();
  return r.code === 0 ? json({ said: r.text }) : json({ error: r.text }, r.code === 2 ? 400 : 409);
};

// Order matters only where a pattern is a prefix of another: the task chat and live routes come before the task detail.
const ROUTES: Route[] = [
  browserRoute,
  chatRoute,
  taskChatRoute,
  taskLiveRoute,
  changesRoute,
  searchRoute,
  homeRoute,
  detectRoute,
  reposRoute,
  addProjectRoute,
  settingsRoute,
  setupRoute,
  accountRoute,
  prefsRoute,
  machinesRoute,
  projectSettingsRoute,
  roadmapRoute,
  stepRoute,
  pushKeyRoute,
  pushSubscribeRoute,
  taskDetailRoute,
  plansRoute,
  inboxRoute,
  appliedRoute,
  undoRoute,
  answerRoute,
];

/** The first route that knows the request answers it. */
export async function route(c: Ctx, req: Request, url: URL): Promise<Response> {
  for (const r of ROUTES) {
    const res = await r(c, req, url);
    if (res) return res;
  }
  return json({ error: "Not found" }, 404);
}
