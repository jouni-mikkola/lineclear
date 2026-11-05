import { useEffect, useState } from "react";
import { useFadeIn } from "../kit/hooks.ts";
import { Chat } from "./chat-view.tsx";
import { chatState, useChat } from "./chat.tsx";
import { ChangesTab } from "./task-changes.tsx";
import { ArtifactsTab, TerminalTab } from "./task-live.tsx";

// The task view at `/task/<id>`: the chat with one task's agent, the page the Inbox and Home link to, and beside it
// the agent's live terminal, the artifacts it made and its changes. The tab is `?tab=` (keys 1 to 4 pick one), so a reload
// or a shared link lands on it.

const TABS = [
  ["chat", "Chat"],
  ["terminal", "Terminal"],
  ["artifacts", "Artifacts"],
  ["changes", "Changes"],
] as const;
type Tab = (typeof TABS)[number][0];

const tabOf = (): Tab => {
  const t = new URLSearchParams(location.search).get("tab");
  return TABS.some(([k]) => k === t) ? (t as Tab) : "chat";
};

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
  // 1 to 4 pick a tab, unless a field has the keys
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
  return (
    <>
      <nav className="mx-auto flex max-w-3xl gap-1 px-4 pt-3" aria-label={`${id} views`} data-task-tabs>
        {TABS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            aria-current={tab === k ? "page" : undefined}
            onClick={() => pick(k)}
            className={`min-h-9 rounded-sm px-3 text-sm focus-visible:outline-2 focus-visible:outline-accent ${tab === k ? "bg-raised3 text-fg" : "text-fg3 hover:text-fg"}`}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === "chat" ? <Chat chat={chat} task={id} /> : <LiveTab key={tab} tab={tab} id={id} />}
    </>
  );
}

// keyed by the tab, so each pick fades its content in
function LiveTab({ tab, id }: { tab: Exclude<Tab, "chat">; id: string }) {
  const box = useFadeIn<HTMLDivElement>();
  return (
    <div ref={box} className="mx-auto max-w-3xl px-4 py-4" data-task-live={tab}>
      {tab === "terminal" ? <TerminalTab id={id} /> : tab === "changes" ? <ChangesTab id={id} /> : <ArtifactsTab id={id} />}
    </div>
  );
}
