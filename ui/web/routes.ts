// Every address Lineclear's views live at. A view, a project, a step and an ask each have one, so a reload or a
// shared link lands on the same thing.
//   /                        Home, where the asks are a strip on top
//   /inbox, /inbox/<ask>     old links: they open /chat, on the ask named
//   /chat, /usage, /settings the views of those names; /setup is the first run, where the models are chosen
//   /task/<id>               one task's chat with its agent
//   /browsers                the agents' browsers, /browsers/<session> one of them
//   /<project>/roadmap       a project's roadmap, /<project>/roadmap/<step> one step

export type View = "home" | "roadmap" | "task" | "browsers" | "chat" | "usage" | "settings" | "setup";
const ROADMAP_PATH = /^\/([a-z0-9][a-z0-9_-]{0,79})\/roadmap(?:\/([^/]+))?$/;
const BROWSERS_PATH = /^\/browsers(?:\/([^/]+))?$/;
const TASK_PATH = /^\/task\/([A-Za-z0-9_-]{1,40})$/;
const INBOX_PATH = /^\/inbox(?:\/([^/]+))?$/;
export const clean = (path: string) => path.replace(/\/+$/, "") || "/";
const FLAT_VIEWS = ["chat", "usage", "settings", "setup"] as const;
const FLAT = ["/", "/chat", "/usage", "/settings", "/setup"];

/** The path of each view that has no part after it. */
export const PATHS: Record<Exclude<View, "roadmap" | "task">, string> = {
  home: "/",
  browsers: "/browsers",
  chat: "/chat",
  usage: "/usage",
  settings: "/settings",
  setup: "/setup",
};

export const roadmapPath = (project: string, step?: string) => `/${project}/roadmap${step === undefined ? "" : `/${encodeURIComponent(step)}`}`;
export const inboxPath = (ask: string | number) => `/inbox/${encodeURIComponent(String(ask))}`;

const decode = (s: string | undefined) => {
  try {
    return s === undefined ? undefined : decodeURIComponent(s);
  } catch {
    return s;
  }
};

export function viewOf(path: string): View {
  const p = clean(path);
  if (ROADMAP_PATH.test(p)) return "roadmap";
  if (TASK_PATH.test(p)) return "task";
  if (BROWSERS_PATH.test(p)) return "browsers";
  if (INBOX_PATH.test(p)) return "chat";
  return FLAT_VIEWS.find((v) => p === `/${v}`) ?? "home";
}

/** The project, step, ask and browser session an address names, if any. */
export const placeOf = (path: string) => {
  const p = clean(path);
  const road = ROADMAP_PATH.exec(p);
  return {
    project: road?.[1],
    step: decode(road?.[2]),
    ask: decode(INBOX_PATH.exec(p)?.[1]),
    session: decode(BROWSERS_PATH.exec(p)?.[1]),
    task: TASK_PATH.exec(p)?.[1],
  };
};

/** Whether App draws this path; main.tsx sends the rest to Home. */
export const isAppPath = (path: string) =>
  FLAT.includes(clean(path)) ||
  ROADMAP_PATH.test(clean(path)) ||
  BROWSERS_PATH.test(clean(path)) ||
  TASK_PATH.test(clean(path)) ||
  INBOX_PATH.test(clean(path));
