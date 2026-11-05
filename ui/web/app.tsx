import { type ComponentProps, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type DispatcherState, ViewFrame } from "../kit/index.ts";
import { chatState, useChat } from "./chat.tsx";
import { sampleState, useAnswer, useBrowsers, useHome, useInbox, usePlans, useRoadmap, useSettings, useStepRecord } from "./data.ts";
import { Frame, hasPanel, useWideRoom } from "./frame.tsx";
import { Home } from "./home.tsx";
import { clean, isAppPath, placeOf, type View, viewOf } from "./routes.ts";

// the views the first screen does not need load when they are opened, so the first script stays small
const TaskView = lazy(() => import("./task.tsx").then((m) => ({ default: m.TaskView })));
const Search = lazy(() => import("./search.tsx").then((m) => ({ default: m.Search })));
const Chat = lazy(() => import("./chat-view.tsx").then((m) => ({ default: m.Chat })));
const Browsers = lazy(() => import("./browsers.tsx").then((m) => ({ default: m.Browsers })));
const Roadmap = lazy(() => import("./roadmap/index.tsx").then((m) => ({ default: m.Roadmap })));
const Setup = lazy(() => import("./setup.tsx").then((m) => ({ default: m.Setup })));
const Settings = lazy(() => import("./settings.tsx").then((m) => ({ default: m.Settings })));

// Lineclear's views, each in its own file and at its own address (routes.ts). The frame around them is frame.tsx.
// This file reads the address, loads what the view shows and changes the view in place when a link is followed.

/** The query a view keeps: a sample `?state=` stays, and `?plan=` comes only with a link to one request's steps. */
const searchFor = (plan?: string) => {
  const q = new URLSearchParams();
  const state = new URLSearchParams(location.search).get("state");
  if (state) q.set("state", state);
  if (plan) q.set("plan", plan);
  return q.size ? `?${q}` : "";
};
// Each history entry has an id, and the scroll place of each entry you left is kept here, so back and forward land
// where you were.
const newId = () => `${Date.now()}-${Math.random()}`;
const places = new Map<string, number>();
let entry = "";
// how many pages deep the history is, so back and forward tell which way a view change went
let depth = 0;
const depthOf = () => (history.state as { n?: number } | null)?.n ?? 0;

/** How long a view waits for its first read before it draws its loading state. Under it the page paints once, read. */
const HOLD_MS = 2500;
// the tab title of the views whose title does not depend on the address
const TITLES: Partial<Record<View, string>> = {
  browsers: "Agent browsers",
  chat: "Dispatcher",
  usage: "Usage",
  settings: "Settings",
};

/** True while a view waits for its first read, within the hold: its elements are laid out but not drawn. */
function useHold(loading: boolean) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLate(true), HOLD_MS);
    return () => clearTimeout(t);
  }, []);
  return loading && !late;
}

/** `/` opens the search, unless a field has the keys. The search code loads on the first one, not with the page. */
function useSearchKey() {
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? "")) return;
      e.preventDefault();
      setSearching(true);
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, []);
  return [searching, setSearching] as const;
}

/** Links and history: a link followed changes the view in place, back and forward keep each entry's scroll place. */
function useNavigation(setPath: (path: string) => void) {
  const scroll = useRef(0);
  // the card a link was followed from, so its page grows out of it; back and forward leave none
  const [from, setFrom] = useState<DOMRect>();
  const [back, setBack] = useState(false);

  // Every tab and every link to one of these views changes the view in place, without a page load.
  const go = useRef((to: string, plan?: string) => {
    const search = searchFor(plan);
    if (clean(to) === clean(location.pathname) && search === location.search) return;
    places.set(entry, scrollY);
    entry = newId();
    history.pushState({ id: entry, n: ++depth }, "", clean(to) + search);
    scroll.current = 0;
    setPath(clean(to));
  }).current;
  useEffect(() => {
    history.scrollRestoration = "manual";
    entry = (history.state as { id?: string } | null)?.id ?? newId();
    depth = depthOf();
    history.replaceState({ id: entry, n: depth }, "");
    const back = () => {
      places.set(entry, scrollY);
      entry = (history.state as { id?: string } | null)?.id ?? "";
      scroll.current = places.get(entry) ?? 0;
      setFrom(undefined);
      setBack(depthOf() < depth);
      depth = depthOf();
      setPath(clean(location.pathname));
    };
    const click = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if ((a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href);
      if (url.origin !== location.origin || !isAppPath(url.pathname)) return;
      e.preventDefault();
      setFrom(a.closest("main") ? a.closest("li, article, [data-card]")?.getBoundingClientRect() : undefined);
      // a link marked as a way back slides the way back
      setBack(a.hasAttribute("data-back"));
      go(url.pathname, url.searchParams.get("plan") ?? undefined);
    };
    addEventListener("popstate", back);
    document.addEventListener("click", click);
    return () => {
      removeEventListener("popstate", back);
      document.removeEventListener("click", click);
    };
  }, [go, setPath]);
  return { scroll, from, back, go };
}

/** `?plan=<task>`: the steps of one request, marked on its project's roadmap; a request that cannot be shown says why. */
function usePlan(state: ReturnType<typeof sampleState>, onRoadmap: boolean) {
  const planId = onRoadmap ? new URLSearchParams(location.search).get("plan") : null;
  const plans = usePlans(state, !!planId);
  const plan = planId && plans.status === "ok" ? plans.data.find((p) => p.task === planId) : undefined;
  const planNote =
    !planId || plan
      ? undefined
      : plans.status === "loading"
        ? `Reading request ${planId}.`
        : plans.status === "error"
          ? `Request ${planId} cannot be read: ${plans.error}`
          : `There is no request ${planId}.`;
  return { plan, planNote };
}

/** What the Dispatcher's window shows: its read state, or offline when the server cannot be reached. */
function panelStateOf(chat: ReturnType<typeof useChat>): DispatcherState {
  const reached = chat.online && !chat.lost;
  if (!chat.view) return "loading";
  if (chat.view.state !== "ready") return chat.view.state;
  if (!reached) return "offline";
  return chat.view.writing ? "writing" : "ready";
}

/** The tab title: the roadmap and the task name theirs, the other views have a fixed one. */
function useTabTitle(view: View, project: string | undefined, step: string | undefined, task: string | undefined) {
  useEffect(() => {
    const own = view === "roadmap" ? `${step === undefined ? "" : `${step} · `}${project} roadmap` : view === "task" ? task : TITLES[view];
    document.title = own ? `${own} · Lineclear` : "Lineclear";
  }, [view, project, step, task]);
}

type PageProps = {
  view: View;
  shown: View;
  state: ReturnType<typeof sampleState>;
  home: ReturnType<typeof useHome>;
  open: ComponentProps<typeof Home>["open"];
  items: ReturnType<typeof useInbox>;
  ask: string | undefined;
  errors: ReturnType<typeof useAnswer>["errors"];
  onAnswer: ReturnType<typeof useAnswer>["answer"];
  browsers: ReturnType<typeof useBrowsers>;
  chat: ReturnType<typeof useChat>;
  panelState: DispatcherState;
  usageOpen: boolean;
  setUsageOpen: (open: boolean) => void;
  go: (to: string, plan?: string) => void;
  roadmap: ReturnType<typeof useRoadmap>;
  stepRecord: ReturnType<typeof useStepRecord>;
  plan: ReturnType<typeof usePlan>["plan"];
  planNote: string | undefined;
  step: string | undefined;
  settings: ReturnType<typeof useSettings>;
  task: string | undefined;
  session: string | undefined;
};

/** The view the address names. Home is the page for usage, the chat and the browsers too. */
function Page(p: PageProps) {
  const { view, state } = p;
  if (p.shown === "home") {
    return (
      <Home
        home={p.home}
        open={p.open}
        asksRead={p.items.status !== "loading"}
        ask={p.ask}
        errors={p.errors}
        onAnswer={(item, choice, note) => void p.onAnswer(item, choice, note)}
        browsers={p.browsers}
        sample={!!state}
        chat={<Chat chat={p.chat} panel />}
        chatState={p.panelState}
        usageOpen={p.usageOpen || view === "usage"}
        setUsageOpen={(o) => (o ? p.setUsageOpen(true) : view === "usage" ? p.go("/") : p.setUsageOpen(false))}
      />
    );
  }
  if (view === "roadmap") return <Roadmap load={p.roadmap} record={p.stepRecord} plan={p.plan} planNote={p.planNote} step={p.step} />;
  if (view === "settings") return <Settings load={p.settings} sample={!!state} />;
  if (view === "setup") return <Setup />;
  if (view === "task" && p.task) return <TaskView key={p.task} id={p.task} />;
  if (view === "browsers") return <Browsers load={p.browsers} session={p.session} sample={!!state} />;
  return null;
}

export function App() {
  const state = sampleState();
  const [path, setPath] = useState(() => clean(location.pathname));
  const view = viewOf(path);
  const { project, step, ask, session, task } = placeOf(path);
  const [usageOpen, setUsageOpen] = useState(false);
  const [searching, setSearching] = useSearchKey();
  const { scroll, from, back, go } = useNavigation(setPath);
  // the chat keeps its own place: the newest message
  useLayoutEffect(() => {
    if (view !== "chat" && view !== "task") scrollTo(0, scroll.current);
  }, [path, view, scroll]);
  useTabTitle(view, project, step, task);

  const home = useHome(state);
  const roadmap = useRoadmap(project ?? "", state, view === "roadmap");
  const stepRecord = useStepRecord(project ?? "", view === "roadmap" && step !== "track" ? step : undefined, state);
  const { plan, planNote } = usePlan(state, view === "roadmap");
  const items = useInbox(state);
  const browsers = useBrowsers(state, view === "browsers");
  const settings = useSettings(state, view === "settings");
  const [panelOpen, setPanelOpen] = useState(false);
  const wide = useWideRoom();
  const paneled = hasPanel(view === "usage" ? "home" : view) && (panelOpen || wide);
  const chat = useChat(chatState(), view === "chat" || view === "home" || paneled);
  const { gone, errors, answer: onAnswer } = useAnswer(state);
  const open = items.status === "ok" ? items.data.filter((i) => !gone.has(i.id)) : [];
  const projects = home.status === "ok" ? home.data.projects : [];

  const read = (l: { status: string }) => l.status !== "loading";
  const charts = home.status !== "ok" || (!!home.data.spend && !!home.data.usage);
  // the frame draws the Inbox count and the projects' lamps, so every view waits for those reads too
  const own: Partial<Record<View, boolean>> = {
    usage: charts,
    roadmap: read(roadmap),
    settings: read(settings),
    browsers: read(browsers),
    chat: !!chat.view,
  };
  const loading = !state && !(read(home) && read(items) && (own[view] ?? true));
  const hold = useHold(loading);

  const panelState = panelStateOf(chat);

  // an old /inbox address is Home
  useEffect(() => {
    if (view === "home" && path === "/inbox") history.replaceState(history.state, "", `/${location.search}`);
  }, [view, path]);
  // /usage is Home with its usage sheet open
  // Home is the one page for these: they open it, the usage one with its sheet
  const shown = view === "usage" || view === "chat" || view === "browsers" ? "home" : view;
  const page: PageProps = {
    view,
    shown,
    state,
    home,
    open,
    items,
    ask,
    errors,
    onAnswer,
    browsers,
    chat,
    panelState,
    usageOpen,
    setUsageOpen,
    go,
    roadmap,
    stepRecord,
    plan,
    planNote,
    step,
    settings,
    task,
    session,
  };
  return (
    <div className="contents" style={hold ? { visibility: "hidden" } : undefined}>
      {searching && (
        <Suspense fallback={null}>
          <Search go={go} onClose={() => setSearching(false)} />
        </Suspense>
      )}
      <Frame
        view={shown}
        project={project}
        projects={projects}
        sample={state}
        panel={
          <Suspense fallback={null}>
            <Chat chat={chat} panel />
          </Suspense>
        }
        panelOpen={panelOpen}
        onPanel={setPanelOpen}
        panelState={panelState}
      >
        <ViewFrame view={view} at={path} back={back} from={from} landing={view === "chat" || view === "task" ? undefined : scroll.current}>
          <Suspense fallback={null}>
            <Page {...page} />
          </Suspense>
        </ViewFrame>
      </Frame>
    </div>
  );
}
