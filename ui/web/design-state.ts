import { useCallback, useState } from "react";
import {
  type Browser,
  type Machine,
  type MachineState,
  type MOTIONS,
  type PartState,
  play,
  type Stage,
  type Task,
  type TaskState,
  type ThreadItem,
} from "../kit/index.ts";
import { browserSamples } from "./browser-samples.ts";
import { chatSample } from "./chat-samples.ts";
import { inbox, type PageState, projects, spend } from "./samples.ts";
import { settingsSample } from "./settings-samples.ts";

export const VIEWS = [
  { id: "home", label: "Home" },
  { id: "inbox", label: "Inbox" },
  { id: "browsers", label: "Browsers" },
  { id: "chat", label: "Chat" },
  { id: "settings", label: "Settings" },
] as const;
export type ViewId = (typeof VIEWS)[number]["id"];

const PART_CYCLE: PartState[] = ["filled", "empty", "loading", "error"];
const MACHINE_CYCLE: MachineState[] = ["installing", "ready", "failed", "unreachable"];

/** Everything the test page changes by hand: one list or flag per part that has a motion. */
export function useDesignState(page: PageState, shown: PartState) {
  const [ps, setPs] = useState(() => projects(page));
  const [items, setItems] = useState(() => inbox(page));
  const [view, setView] = useState<ViewId>("home");
  const [back, setBack] = useState(false);
  const showView = (v: ViewId) => {
    setBack(VIEWS.findIndex((x) => x.id === v) < VIEWS.findIndex((x) => x.id === view));
    setView(v);
  };
  const [panelDemo, setPanelDemo] = useState(false);
  const slideIn = useCallback((el: HTMLElement | null) => {
    if (el) play("chat-open", el, [{ transform: "translateX(100%)" }, { transform: "none" }]);
  }, []);
  const [chartState, setChartState] = useState<PartState>(shown);
  const [arrived, setArrived] = useState(0);
  const [bs, setBs] = useState(() => browserSamples(page).slice(0, 24));
  const [opened, setOpened] = useState(0);
  const [ms, setMs] = useState<Machine[]>(() => settingsSample(page).machines.slice(0, 24));
  const [models, setModels] = useState(() => settingsSample(page).projects[0]?.models ?? { worker: [], reviewer: [], planner: [] });
  const [added, setAdded] = useState(0);
  const [talk, setTalk] = useState<ThreadItem[]>(() =>
    chatSample(page)
      .messages.slice(0, 4)
      .map((m) => ({ key: m.id, who: m.who, text: m.text, file: m.file })),
  );
  const [typing, setTyping] = useState(false);
  const [requested, setRequested] = useState(0);
  const [said, setSaid] = useState(0);
  const [draft, setDraft] = useState("");
  const [days, setDays] = useState(spend);
  return {
    ps,
    setPs,
    items,
    setItems,
    view,
    setView,
    back,
    setBack,
    panelDemo,
    setPanelDemo,
    chartState,
    setChartState,
    arrived,
    setArrived,
    bs,
    setBs,
    opened,
    setOpened,
    ms,
    setMs,
    models,
    setModels,
    added,
    setAdded,
    talk,
    setTalk,
    typing,
    setTyping,
    requested,
    setRequested,
    said,
    setSaid,
    draft,
    setDraft,
    days,
    setDays,
    showView,
    slideIn,
  };
}
export type DesignState = ReturnType<typeof useDesignState>;

/** The motions of the line: tasks start, move, wait and finish; a request arrives; a train and a load move. */
function lineMotions({ ps, setPs, requested, setRequested }: DesignState) {
  const setTask = (project: string, id: string, state: TaskState, stage: Stage) =>
    setPs((all) =>
      all.map((p) =>
        p.name !== project
          ? p
          : { ...p, done: state === "done" ? p.done + 1 : p.done, tasks: p.tasks.map((x) => (x.id === id ? { ...x, state, stage, since: Date.now() } : x)) },
      ),
    );
  const first = (s: TaskState, stages: Stage[] = [s as Stage]) => {
    for (const p of ps) {
      const found = p.tasks.filter((x) => x.state === s && stages.includes(x.stage ?? (s as Stage)));
      if (found.length) return { p, x: s === "queued" ? (found.at(-1) as Task) : (found[0] as Task) };
    }
  };
  return {
    "task-start": () => {
      const f = first("queued");
      if (f) setTask(f.p.name, f.x.id, "work", "work");
    },
    "task-move": () => {
      const f = first("work");
      if (f) setTask(f.p.name, f.x.id, "work", "review");
    },
    "task-finish": () => {
      const f = first("work", ["review", "ready", "work"]);
      if (f) setTask(f.p.name, f.x.id, "done", "done");
    },
    "task-wait": () => {
      const f = first("work", ["work", "review"]);
      if (f) setTask(f.p.name, f.x.id, "need", f.x.stage ?? "work");
    },
    "train-progress": () =>
      setPs((all) => {
        const id = all.flatMap((p) => p.tasks).find((x) => x.state === "work" && x.stage === "work")?.id;
        return all.map((p) => ({
          ...p,
          tasks: p.tasks.map((x) => (x.id === id ? { ...x, progress: (x.progress ?? 0.3) > 0.7 ? 0.2 : (x.progress ?? 0.3) + 0.25 } : x)),
        }));
      }),
    "request-run": () => {
      setRequested((n) => n + 1);
      setPs((all) =>
        all.map((p, i) =>
          i !== 0
            ? p
            : {
                ...p,
                total: p.total + 1,
                tasks: [
                  ...p.tasks,
                  {
                    id: `req${requested}`,
                    title: `R${requested + 1} A new request`,
                    step: `R${requested + 1}`,
                    state: "queued",
                    stage: "queued",
                    since: Date.now(),
                  },
                ],
              },
        ),
      );
    },
    "load-shrink": () =>
      setPs((all) => {
        const id = all.flatMap((p) => p.tasks).find((x) => x.load && x.state === "work" && x.stage === "work")?.id;
        return all.map((p) => ({
          ...p,
          tasks: p.tasks.map((x) =>
            x.id === id && x.load ? { ...x, load: { ...x.load, used: x.load.used > 60_000 ? Math.round(x.load.used * 0.25) : 170_000 } } : x,
          ),
        }));
      }),
    "track-ahead": () =>
      setPs((all) => all.map((p, i) => (p.planning || (i === 0 && !all.some((q) => q.planning)) ? { ...p, planning: true, total: p.total + 1 } : p))),
  };
}

/** The motions of every other view: the Inbox, browsers, machines, models, the chat and the charts. */
function viewMotions(d: DesignState) {
  const {
    ps,
    setPs,
    items,
    setItems,
    arrived,
    setArrived,
    view,
    showView,
    opened,
    setOpened,
    setBs,
    added,
    setAdded,
    setMs,
    setModels,
    said,
    setSaid,
    setTalk,
    setPanelDemo,
    setTyping,
    setChartState,
    setDays,
  } = d;
  return {
    // every task changes to the other account, so the engine that pulls them all changes
    "engine-swap": () => {
      const to = ps.some((p) => p.tasks.some((x) => x.account === "work-subscription")) ? "home-subscription" : "work-subscription";
      setPs((all) => all.map((p) => ({ ...p, tasks: p.tasks.map((x) => (x.account ? { ...x, account: to } : x)) })));
    },
    "inbox-clear": () => {
      const top = items[0];
      if (top) (document.querySelector(`[data-key="${top.id}"] button`) as HTMLElement | null)?.click();
    },
    "inbox-arrive": () => {
      setArrived((n) => n + 1);
      setItems((all) => [
        { id: `new${arrived}`, project: "docs-site", question: `A new question (${arrived + 1}): publish the docs now?`, choices: ["Publish", "Not yet"] },
        ...all,
      ]);
    },
    "view-change": () => showView(VIEWS[(VIEWS.findIndex((x) => x.id === view) + 1) % VIEWS.length]?.id ?? "home"),
    "browser-open": () => {
      setOpened((n) => n + 1);
      const b: Browser = {
        session: `new${opened}`,
        title: `Gift cards (${opened + 1})`,
        task: `new${opened}`,
        project: "web-shop",
        page: { title: "Checkout", url: "http://localhost:5173/checkout" },
        taken: false,
      };
      setBs((all) => [...all.slice(0, 1), b, ...all.slice(1)]);
    },
    "browser-close": () => setBs((all) => all.filter((_, i) => i !== 1)),
    "machine-add": () => {
      setAdded((n) => n + 1);
      setMs((all) => [...all.slice(0, 1), { host: `new-box-${added + 1}`, local: false, state: "installing" }, ...all.slice(1)]);
    },
    "machine-state": () =>
      setMs((all) => all.map((m, i) => (i !== 1 ? m : { ...m, state: MACHINE_CYCLE[(MACHINE_CYCLE.indexOf(m.state) + 1) % MACHINE_CYCLE.length] ?? m.state }))),
    "model-move": () => setModels((all) => ({ ...all, worker: [...all.worker.slice(1), ...all.worker.slice(0, 1)] })),
    "chat-arrive": () => {
      setSaid((n) => n + 1);
      setTalk((all) => [
        ...all,
        {
          key: `new-chat-${said}`,
          who: said % 2 ? "you" : "dispatcher",
          text: said % 2 ? `A new question (${said + 1}): what runs now?` : `An answer (${said + 1}): **web-shop** has 2 tasks at work.`,
        },
      ]);
    },
    "chat-open": () => setPanelDemo((o) => !o),
    "chat-typing": () => setTyping((t) => !t),
    "part-change": () => setChartState((s) => PART_CYCLE[(PART_CYCLE.indexOf(s) + 1) % PART_CYCLE.length] ?? s),
    "value-change": () => setDays((all) => all.map((d, i) => (i === all.length - 1 ? { ...d, dollars: Math.round((d.dollars + 4.5) * 100) / 100 } : d))),
  };
}

export function designMotions(d: DesignState) {
  return { ...lineMotions(d), ...viewMotions(d) } satisfies Record<keyof typeof MOTIONS, () => void>;
}
