import { detectProject, findRepos, saveProject } from "./add-project.ts";
import { readMoves, setPrice, setRetired } from "./full.ts";
import { readPrefs, setShowPaused, shownProjects } from "./prefs.ts";
import { type HomeData, type HomeProject, looseTasks, withProject } from "./home-data.ts";
import type { Ctx } from "./web-ctx.ts";
import { undoApplied } from "./plan-apply.ts";
import { inboxMain } from "./inbox-answer.ts";
import { projectDecisions, readItems } from "./inbox.ts";
import { lineclearDir, worktreeCost } from "./measure.ts";
import { changeSettings } from "./project-change.ts";
import { type AskBefore, listProjectNames, type Role, setupRoles } from "./project.ts";
import { harnesses, readRegistry } from "./models.ts";
import { planViews } from "./requests.ts";
import { saveOffered, setupView } from "./setup.ts";
import { changesReply } from "./task-changes.ts";
import { taskDetailReply } from "./task-detail.ts";
import type { Pusher } from "./notify.ts";
import { taskLiveApi } from "./task-live.ts";
import { waitingForYou } from "./waiting.ts";
import { browserApi, chatApi } from "./web-chat-api.ts";
import { fail, json, ownPage } from "./web-guard.ts";
import { accountSettings, settingsList, type SettingsData } from "./web-settings.ts";
import { doctorProblems } from "./home-doctor.ts";
import { appliedChanges, inboxView, planCard, waitingView } from "./web-views.ts";

type Reply = Response | undefined;
type Route = (c: Ctx, req: Request, url: URL) => Reply | Promise<Reply>;
type Hit = { req: Request; m: string[]; url: URL };
type Handler = (c: Ctx, hit: Hit) => Reply | Promise<Reply>;

const ID = "[A-Za-z0-9_-]{1,40}";
const PROJECT = "[a-z0-9][a-z0-9_-]{0,79}";
const sentence = (text: string) => text[0]?.toUpperCase() + text.slice(1);
const problemReply = (problem: string, status = 400) => fail(sentence(problem) + (problem.endsWith(".") ? "" : "."), status);
const asJson = async (req: Request) => (await req.json().catch(() => ({}))) as Record<string, unknown>;
const proc = (c: Ctx) => c.env as NodeJS.ProcessEnv;

/**
 * A route: `path` (a string or a pattern whose groups reach the handler) and `method` pick the request. With `only`, a POST not
 * from Lineclear's own pages is refused with "<only> only from Lineclear's own pages."
 */
const on =
  (method: string, path: string | RegExp, handle: Handler, only?: string): Route =>
  (c, req, url) => {
    const m = typeof path === "string" ? (url.pathname === path ? [] : null) : path.exec(url.pathname);
    if (req.method !== method || !m) return undefined;
    if (only && !ownPage(req, url, c.env)) return fail(`${only} only from Lineclear's own pages.`, 403);
    return handle(c, { req, m: [...m].map((s) => s ?? ""), url });
  };
const get = (path: string | RegExp, handle: Handler) => on("GET", path, handle);
const post = (path: string | RegExp, only: string, handle: Handler) => on("POST", path, handle, only);
const under = (prefix: string) => new RegExp(`^${prefix}(?:/|$)`);

// Order matters only where a pattern is a prefix of another: the task chat and live routes come before the task detail.
const ROUTES: Route[] = [
  (c, req, url) => (under("/api/browsers").test(url.pathname) ? browserApi(req, url, c.live, c.env) : undefined),
  (c, req, url) => (under("/api/chat").test(url.pathname) ? chatApi(req, url, c.dispatcher, c.env, "/api/chat") : undefined),
  (c, req, url) => {
    const task = new RegExp(`^/api/task/(${ID})/chat(/.*)?$`).exec(url.pathname);
    return task ? chatApi(req, url, () => c.taskChats(task[1] ?? ""), c.env, `/api/task/${task[1]}/chat`) : undefined;
  },
  (c, req, url) => {
    const live = new RegExp(`^/api/task/(${ID})(/terminal(?:/.*)?)$`).exec(url.pathname);
    return live ? taskLiveApi(req, live[1] ?? "", live[2] ?? "", c.taskTerminals, ownPage(req, url, c.env)) : undefined;
  },
  get(new RegExp(`^/api/task/(${ID})/changes$`), (c, { m }) => changesReply(m[1] ?? "", lineclearDir(c.env), json)),
  get("/api/home", async (c) => {
    const t = c.now();
    const list = await c.readProjects(t);
    // each roadmap Home can link to is read before it is asked for
    for (const name of [...listProjectNames(c.env), ...list.flatMap((p: HomeProject) => (p.roadmap ? [p.roadmap] : []))]) {
      if (!c.warmed.has(name)) void c.roadmap(name).ready();
      c.warmed.add(name);
    }
    return json({
      projects: shownProjects(withProject(list), readPrefs(proc(c))),
      loose: looseTasks(list),
      planning: planViews(c.env).filter((r) => r.state === "planning").length,
      dispatcher: { writing: c.dispatcher().view().writing },
      doctor: doctorProblems(c.env, t).map((p) => `${p.problem}: ${p.fix}`),
      moves: readMoves(proc(c), 5),
    } satisfies Partial<HomeData>);
  }),
  get("/api/detect", (c, { url }) => {
    const found = detectProject(url.searchParams.get("repo") ?? "", c.env);
    return "error" in found ? json(found, 400) : json(found);
  }),
  get("/api/repos", (c) => json({ repos: findRepos(c.env) })),
  post("/api/projects", "Projects are added", async (c, { req }) => {
    const r = await saveProject(await asJson(req), c.env);
    if ("error" in r) return fail(r.error, r.status);
    c.forgetProjects();
    return json({ added: r.name, ...(r.planning ? { planning: true } : {}) }, 201);
  }),
  get("/api/setup", (c) => json(setupView(readRegistry(harnesses(c.env)), c.env))),
  post("/api/setup", "Models are chosen", async (c, { req }) => {
    const body = await asJson(req);
    const choice = Object.fromEntries(setupRoles.flatMap((r) => (typeof body[r] === "string" ? [[r, body[r]]] : [])));
    const problem = saveOffered(choice, readRegistry(harnesses(c.env)), c.env);
    return problem ? problemReply(problem) : json({ saved: true });
  }),
  get("/api/settings", (c) =>
    json({ projects: settingsList(c.env), accounts: accountSettings(c.env), showPaused: readPrefs(proc(c)).showPaused === true } satisfies SettingsData),
  ),
  post(/^\/api\/accounts\/([^/]+)$/, "Prices change", async (c, { req, m }) => {
    const body = await asJson(req);
    const name = decodeURIComponent(m[1] ?? "");
    const problem = body.retired !== undefined ? setRetired(name, body.retired, proc(c)) : setPrice(name, body.price, body.currency, proc(c));
    return problem ? problemReply(problem) : json({ saved: name });
  }),
  post("/api/prefs", "This changes", async (c, { req }) => {
    const problem = setShowPaused((await asJson(req)).showPaused, proc(c));
    return problem ? problemReply(problem) : json({ saved: true });
  }),
  post(new RegExp(`^/api/projects/(${PROJECT})$`), "Settings change", async (c, { req, m }) => {
    const body = await asJson(req);
    const change = {
      check: body.check as string | undefined,
      health: body.health as string | undefined,
      models: body.models as Partial<Record<Role, string[]>> | undefined,
      askBefore: body.askBefore as Partial<AskBefore> | undefined,
      paused: body.paused as boolean | undefined,
    };
    const r = changeSettings(m[1] ?? "", change, proc(c));
    if (typeof r === "string") return problemReply(r, r.startsWith("no project") ? 404 : 400);
    c.forgetProjects();
    return json({ saved: m[1] });
  }),
  get(new RegExp(`^/api/roadmap/(${PROJECT})$`), async (c, { m }) => {
    // a roadmap no one looked at for a minute is read again first, so the view never opens on an old one
    const r = await c.roadmap(m[1] ?? "").ready(60_000);
    if (!r) return fail("The roadmap could not be read. Try again.", 500);
    return "ok" in r
      ? json({ ...r.ok, decisions: projectDecisions(r.ok.project, r.ok.steps, c.env) })
      : json({ error: r.error, ...(r.file ? { file: r.file } : {}), ...(r.lines ? { lines: r.lines } : {}) }, r.status);
  }),
  get(new RegExp(`^/api/roadmap/${PROJECT}/step/[^/]+$`), async (c, { url }) => {
    const step = decodeURIComponent(url.pathname.slice(13)).replace("/step/", "/");
    const record = (await c.aside("step", step).catch(() => undefined)) as { error?: string; status?: number } | undefined;
    if (!record) return fail("The step could not be read. Try again.", 500);
    return record.error ? fail(record.error, record.status ?? 500) : json(record);
  }),
  get("/api/push/key", async (c) => json({ key: (await c.push?.catch(() => undefined))?.publicKey ?? null })),
  post("/api/push/subscribe", "Alerts are allowed", async (c, { req }) => {
    const pusher = await c.push?.catch(() => undefined);
    const b = (await asJson(req)) as { sub?: { endpoint?: unknown; keys?: unknown }; device?: unknown };
    if (!pusher) return fail("Push is not available on this server.", 503);
    if (typeof b.sub?.endpoint !== "string" || !b.sub.keys || typeof b.device !== "string") return fail("No subscription was given.");
    pusher.subscribe(b.sub as Parameters<Pusher["subscribe"]>[0], b.device.slice(0, 80));
    return json({ ok: true });
  }),
  get(/^\/api\/task\/(.*)$/, (c, { m }) =>
    taskDetailReply(m[1] ?? "", { lineclear: lineclearDir(c.env), costSoFar: (w) => worktreeCost(w, c.env) }, c.env, c.now(), json),
  ),
  get("/api/plans", (c) => json(planViews(c.env).map(planCard))),
  get("/api/inbox", async (c) => {
    const w = waitingForYou(c.env, await c.readProjects(c.now()));
    return json([...w.items.map((i) => inboxView(i, i.machine, i.title, i.result)), ...w.tasks.map((t) => waitingView(t))]);
  }),
  get(new RegExp(`^/api/applied/(${PROJECT})$`), (c, { m }) => json(appliedChanges(m[1] ?? "", c.env))),
  post(/^\/api\/inbox\/(\d+)\/undo$/, "Plans are undone", (c, { m }) => {
    const item = readItems(proc(c)).find((i) => i.n === Number(m[1]));
    if (!item) return fail(`There is no item ${m[1]}.`, 404);
    const problem = undoApplied(item, new Date(), proc(c));
    if (problem) return problemReply(problem, 409);
    c.forgetProjects();
    c.forgetRoadmap(item.project ?? "");
    return json({ undone: item.n });
  }),
  post(/^\/api\/inbox\/(\d+)$/, "Answers come", async (c, { req, m }) => {
    const { choice, note } = await asJson(req);
    if (typeof choice !== "string" || !choice) return fail("No answer was given.");
    const reason = typeof note === "string" && note.trim() ? ["--note", note.trim()] : [];
    const said: string[] = [];
    const code = inboxMain(["answer", m[1] ?? "", choice, ...reason], (l) => said.push(l), c.env);
    c.forgetProjects();
    return code === 0 ? json({ said: said.join(" ") }) : fail(said.join(" "), code === 2 ? 400 : 409);
  }),
];

/** The first route that knows the request answers it. */
export async function route(c: Ctx, req: Request, url: URL): Promise<Response> {
  for (const r of ROUTES) {
    const res = await r(c, req, url);
    if (res) return res;
  }
  return fail("Not found", 404);
}
