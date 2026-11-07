import {
  BottomBar,
  DispatcherHead,
  DispatcherIcon,
  type DispatcherState,
  type LampState,
  type NavItem,
  Notice,
  type Project,
  SideRail,
  ViewBoundary,
} from "../kit/index.ts";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { play } from "../kit/motion.ts";
import { SAMPLE_OFFLINE } from "./data.ts";
import { useTrouble } from "./health.ts";
import type { PageState } from "./states.ts";
import { useInbox } from "./data.ts";
import { InboxView } from "./inbox-strip.tsx";
import { PATHS, placeOf, roadmapPath, type View, viewOf } from "./routes.ts";

/** The wordmark as index.html has it before the script runs: vite.config.ts puts it in. */
declare const __WORDMARK__: string;

// The frame every view sits in. From 1024 px a rail on the left holds the mark, the views and a row per project;
// under it a bar at the bottom leads Home, the Inbox, Browsers and Settings, and Settings is a gear at the top right too.
// Content runs up to `--lc-content-w` on 12 columns, centred in the room right of the rail. The rail and the bar are
// links, the view you are on marked with `aria-current`. Home is one page that fills the window: its own columns hold the line, the table and the chat.

const icon = (paths: string) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={paths} />
  </svg>
);

const BAR: { id: Exclude<View, "roadmap" | "task" | "setup" | "chat" | "usage">; label: string; icon: React.ReactNode }[] = [
  { id: "home", label: "Home", icon: icon("M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10") },
  { id: "inbox", label: "Inbox", icon: icon("M3 13l3-8h12l3 8M3 13v6h18v-6M3 13h5a4 4 0 0 0 8 0h5") },
  { id: "browsers", label: "Browsers", icon: icon("M3 5h18v14H3zM3 9h18M7 7h.01") },
  {
    id: "settings",
    label: "Settings",
    icon: icon("M4 7h10M18 7h2M4 17h2M10 17h10M16 5v4M8 15v4"),
  },
];

/** From this width the panel stays open on the pages that have one. */
const WIDE = "(min-width: 1920px)";

/** Whether the room is wide enough for the chat panel to stay open. */
export function useWideRoom() {
  const [wide, setWide] = useState(() => matchMedia(WIDE).matches);
  useEffect(() => {
    const q = matchMedia(WIDE);
    const up = () => setWide(q.matches);
    q.addEventListener("change", up);
    return () => q.removeEventListener("change", up);
  }, []);
  return wide;
}

/** The views that have the chat as a panel beside them: Home and the Chat view have the chat in themselves. */
export const hasPanel = (view: View) => view !== "home" && view !== "chat" && view !== "task";

const lamp = (p: Project): LampState => (p.broken ? "broken" : p.tasks.some((t) => t.state === "need") ? "wait" : "clear");

// A notice that comes and goes with every slow or failed read floats over the page and lets taps through, so the page below never jumps;
// one that stays (the service stopped, a file that fails its check) takes its place in the flow.
function TroubleNotice({ trouble, home }: { trouble: NonNullable<ReturnType<typeof useTrouble>>; home: boolean }) {
  const notice = <Notice key={trouble.kind} trouble={trouble} />;
  if (trouble.kind === "stopped" || trouble.kind === "broken") return home ? <div className="px-5 pt-4 md:px-10 lg:px-6">{notice}</div> : notice;
  return (
    <div className="pointer-events-none fixed inset-x-3 top-2 z-30 mx-auto max-w-(--lc-content-w) lg:left-(--lc-rail-w) [&>*]:shadow-lg" data-notice-float>
      {notice}
    </div>
  );
}

/** One tree for every view, so the view's frame survives a move between Home and the others and plays its motion. */
function Content({ view, trouble, children }: { view: View; trouble: ReturnType<typeof useTrouble>; children: React.ReactNode }) {
  const home = view === "home";
  return (
    <main
      className={
        home ? "pb-(--bar-h) lg:pb-0" : `px-5 pt-6 md:px-10 lg:pt-8 ${view === "chat" || view === "task" ? "pb-(--bar-h)" : "pb-[calc(var(--bar-h)+64px)]"}`
      }
      data-content={home ? "" : undefined}
    >
      <div className={home ? "contents" : "mx-auto grid max-w-(--lc-content-w) grid-cols-12 gap-x-6"} data-content={home ? undefined : ""}>
        <div className={home ? "contents" : "col-span-12 mt-2 min-w-0 lg:mt-0"}>
          {trouble && <TroubleNotice trouble={trouble} home={home} />}
          <ViewBoundary resetKey={location.pathname}>{children}</ViewBoundary>
        </div>
      </div>
    </main>
  );
}

export function Frame({
  view,
  project,
  projects,
  sample,
  panel,
  panelOpen = false,
  onPanel,
  panelState = "loading",
  children,
}: {
  view: View;
  /** The project whose roadmap is open, if any. */
  project?: string;
  projects: Project[];
  /** The sample state of a page drawn with `?state=`; the offline one says "not updated since" in place of the live reads. */
  sample?: PageState;
  /** The chat, drawn in the panel. */
  panel?: React.ReactNode;
  panelOpen?: boolean;
  /** Opens or closes the panel; from 1920 px it stays open and has no close. */
  onPanel?: (open: boolean) => void;
  panelState?: DispatcherState;
  children: React.ReactNode;
}) {
  const trouble = useTrouble(sample === "offline" && view === "home" ? { kind: "stale", since: SAMPLE_OFFLINE } : undefined);
  const inbox = useInbox(sample);
  const waiting = inbox.status === "ok" ? inbox.data.length : 0;
  const bar: NavItem[] = BAR.map((v) => ({ ...v, href: PATHS[v.id], count: v.id === "inbox" ? waiting : undefined }));
  // a roadmap is a page under its project's row
  const wide = useWideRoom();
  const showPanel = !!panel && hasPanel(view) && (panelOpen || wide);
  // the panel slides in when it opens, not when a page that has it open from the start is drawn
  const aside = useRef<HTMLElement>(null);
  const wasOpen = useRef(showPanel);
  useLayoutEffect(() => {
    if (showPanel && !wasOpen.current && aside.current) play("chat-open", aside.current, [{ transform: "translateX(100%)" }, { transform: "none" }]);
    wasOpen.current = showPanel;
  }, [showPanel]);
  // the address names the view you are on: Usage and the chat are drawn on Home, but their link is the one marked. A task is no view, so it marks none
  const at = viewOf(location.pathname);
  const current = view === "roadmap" ? `project:${project}` : at === "task" ? "" : at === "usage" || at === "chat" ? "home" : at;
  const shown = view === "inbox" ? <InboxView sample={sample} ask={placeOf(location.pathname).ask} /> : children;
  return (
    <div className={`min-h-dvh lg:pl-(--lc-rail-w) ${showPanel ? "lg:pr-[400px]" : ""}`} data-frame>
      <div className="fixed inset-y-0 left-0 z-20 hidden lg:block">
        <SideRail items={bar} current={current} projects={projects.map((p) => ({ name: p.name, href: roadmapPath(p.roadmap ?? p.name), lamp: lamp(p) }))} />
      </div>
      <header className="flex items-center justify-between gap-4 px-5 pt-6 md:px-10 md:pt-8 lg:hidden">
        <a href={PATHS.home} aria-label="Lineclear, Home" className="flex h-9 items-center rounded-sm hover:opacity-80">
          <span className="contents" dangerouslySetInnerHTML={{ __html: __WORDMARK__ }} />
        </a>
        <div className="flex items-center gap-2">
          <a
            href={PATHS.chat}
            aria-label="Chat with the Dispatcher"
            className="flex h-9 items-center gap-2 rounded-full border border-line bg-raised px-3 text-sm text-fg hover:border-fg3 focus-visible:outline-2 focus-visible:outline-accent"
            data-chat-entry
          >
            <DispatcherIcon size={18} className="text-fg2" />
            Chat
          </a>
          <a
            href={PATHS.settings}
            aria-current={view === "settings" ? "page" : undefined}
            className={`grid size-9 shrink-0 place-items-center rounded-full hover:bg-raised3 hover:text-fg ${view === "settings" ? "bg-raised3 text-fg" : "bg-raised2 text-fg2"}`}
            data-gear
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
            </svg>
            <span className="sr-only">Settings</span>
          </a>
        </div>
      </header>
      {panel && hasPanel(view) && !showPanel && (
        <button
          type="button"
          onClick={() => onPanel?.(true)}
          aria-label="Open the chat"
          className="fixed right-6 top-6 z-30 hidden h-11 items-center gap-2 rounded-full border border-line bg-raised px-4 text-fg hover:border-fg3 focus-visible:outline-2 focus-visible:outline-accent lg:flex"
          data-chat-open
        >
          <DispatcherIcon size={20} className="text-fg2" />
          Chat
        </button>
      )}
      {showPanel && (
        <aside
          ref={aside}
          className="fixed inset-y-0 right-0 z-20 hidden w-[400px] flex-col border-l border-line bg-base lg:flex"
          aria-label="Chat"
          data-chat-panel
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
            <DispatcherHead state={panelState} beside />
            {!wide && (
              <button
                type="button"
                onClick={() => onPanel?.(false)}
                aria-label="Close the chat"
                className="grid size-9 shrink-0 place-items-center rounded-full text-fg2 hover:bg-raised3 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
                data-chat-close
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
                  <path d="M3 3l10 10M13 3L3 13" />
                </svg>
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1">{panel}</div>
        </aside>
      )}
      <Content view={view} trouble={trouble}>
        {shown}
      </Content>
      <div className="fixed inset-x-0 bottom-0 z-30 bg-base pb-[env(safe-area-inset-bottom,0px)] lg:hidden" data-bar>
        <BottomBar items={bar} current={current} />
      </div>
    </div>
  );
}
