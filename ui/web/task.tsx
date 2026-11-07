import { useEffect, useState } from "react";
import { useFadeIn } from "../kit/hooks.ts";
import type { Task } from "../kit/parts.tsx";
import { TaskHead, TaskNotFound } from "../kit/task-head.tsx";
import { Chat } from "./chat-view.tsx";
import { chatState, useChat } from "./chat.tsx";
import { sampleState, useHome } from "./data.ts";
import { ChangesTab } from "./task-changes.tsx";

// The task view at `/task/<id>`: the chat with one task's agent, the page the Inbox and Home link to, and beside it
// its changes. The tab is `?tab=` (keys 1 and 2 pick one), so a reload
// or a shared link lands on it.

const TABS = [
  ["chat", "Chat"],
  ["changes", "Changes"],
] as const;
type Tab = (typeof TABS)[number][0];

const tabOf = (): Tab => {
  const t = new URLSearchParams(location.search).get("tab");
  return TABS.some(([k]) => k === t) ? (t as Tab) : "chat";
};

// The sample states know one task; any other id is one nothing has.
const SAMPLE_TASK: Task = {
  id: "WEB-3",
  title: "W3 Totals follow the removed line",
  state: "work",
  stage: "review",
  step: "W3",
  model: "vendor-b/model-review",
};

// `?long=1` on a sample page draws a 200-character title
const sampleTask = (): Task =>
  new URLSearchParams(location.search).has("long") ? { ...SAMPLE_TASK, title: "Long title ".repeat(20).trim().slice(0, 200) } : SAMPLE_TASK;

/** The task as the board lists it: undefined while the board loads, null when it does not have it. */
function useTaskFacts(id: string): Task | null | undefined {
  const sample = sampleState();
  const home = useHome(sample);
  if (sample) return sample === "loading" ? undefined : id === SAMPLE_TASK.id ? sampleTask() : null;
  if (home.status !== "ok") return undefined;
  return [...home.data.projects.flatMap((p) => p.tasks), ...(home.data.loose ?? [])].find((t) => t.id === id) ?? null;
}

export function TaskView({ id }: { id: string }) {
  const chat = useChat(chatState(), true, `/api/task/${encodeURIComponent(id)}/chat`);
  const [tab, setTab] = useState<Tab>(tabOf);
  const pick = (t: Tab) => {
    const q = new URLSearchParams(location.search);
    if (t === "chat") q.delete("tab");
    else q.set("tab", t);
    history.replaceState(history.state, "", `${location.pathname}${q.size ? `?${q}` : ""}`);
    setTab(t);
  };
  // 1 and 2 pick a tab, unless a field has the keys
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? "")) return;
      const tab = TABS[Number(e.key) - 1]?.[0];
      if (tab) pick(tab);
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  });
  const task = useTaskFacts(id);
  // a task the board lacks and whose chat is missing too is no task here; one with a chat is only older than the board's list
  if (task === null && (sampleState() || chat.view?.state === "none")) return <TaskNotFound id={id} />;
  return (
    <div className="mx-auto w-full max-w-[760px]">
      <TaskHead id={id} task={task ?? undefined}>
        <nav className="mt-3 flex gap-5" aria-label={`${id} views`} data-task-tabs>
          {TABS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-current={tab === k ? "page" : undefined}
              onClick={() => pick(k)}
              className={`min-h-9 border-b-2 text-sm focus-visible:outline-2 focus-visible:outline-accent ${tab === k ? "border-accent text-fg" : "border-transparent text-fg3 hover:text-fg"}`}
            >
              {label}
            </button>
          ))}
        </nav>
      </TaskHead>
      {tab === "chat" ? <Chat chat={chat} task={id} /> : <ChangesBox key={tab} id={id} />}
    </div>
  );
}

// keyed by the tab, so each pick fades its content in
function ChangesBox({ id }: { id: string }) {
  const box = useFadeIn<HTMLDivElement>();
  return (
    <div ref={box} className="py-4" data-task-live="changes">
      <ChangesTab id={id} />
    </div>
  );
}
