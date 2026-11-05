import { memo, useState } from "react";
import {
  answer,
  Answer,
  BarChart,
  BottomBar,
  Card,
  count,
  DataTable,
  EmptyTrack,
  LAMP_WORD,
  type LampState,
  LaidTrack,
  dollars,
  type NavItem,
  ParallelTracks,
  Reveal,
  Row,
  RowList,
  SideRail,
  SidePanel,
  StaleBar,
  StateLamp,
  Tile,
  Notice,
  Toast,
  BrowserCard,
  BrowserGrid,
  Button,
  ChatEmpty,
  ChatThread,
  Composer,
  DispatcherHead,
  InboxList,
  MachineCard,
  MachineList,
  MOTIONS,
  ProjectSettingsCard,
  ROLES,
  Panel,
  Part,
  type PartState,
  ProjectCard,
  TheLine,
  Shape,
  SpendChart,
  STATE_WORD,
  Stop,
  Typing,
  UsageChart,
  ViewFrame,
  ViewNav,
} from "../kit/index.ts";
import { ModelList } from "../kit/model-list.tsx";
import { samplePictureOf } from "./browser-samples.ts";
import { chatSampleAttached } from "./chat-samples.ts";
import { moves, PAGE_STATES, type PageState, projects, QUESTIONS, spend, STATES, usage } from "./samples.ts";
import { type DesignState, designMotions, useDesignState, VIEWS, type ViewId } from "./design-state.ts";
import { settingsSample } from "./settings-samples.ts";

// The design system's test page: every part in the state named by ?state=, and a button for every motion.

const VIEW_TEXT: Record<ViewId, string> = {
  home: "Is the line clear? Each project as a track, each task as a shape.",
  inbox: "The only place that asks you, with the answers as buttons.",
  browsers: "The agents' browsers, live, to watch or take over.",
  chat: "Talk to the Dispatcher, with pictures and files.",
  settings: "Machines, accounts and model lists, and projects.",
};

const MOTION_LABEL: Record<keyof typeof MOTIONS, string> = {
  "task-start": "Start a task",
  "task-move": "Move a task",
  "task-finish": "Finish a task",
  "task-wait": "A task waits for you",
  "train-progress": "A worker reports progress",
  "request-run": "A request is made",
  "load-shrink": "A worker's context is compacted",
  "track-ahead": "The planner writes a step",
  "engine-swap": "An account takes over",
  "inbox-clear": "Answer an Inbox item",
  "inbox-arrive": "An Inbox item arrives",
  "view-change": "Change the view",
  "browser-open": "A browser opens",
  "browser-close": "A browser closes",
  "machine-add": "Add a machine",
  "machine-state": "A machine changes state",
  "model-move": "Move a model",
  "chat-arrive": "A chat message arrives",
  "chat-open": "The Chat panel opens",
  "chat-typing": "The Dispatcher writes",
  "part-change": "Change a part's state",
  "value-change": "Change a value",
};

const NAV: NavItem[] = [
  { id: "home", label: "Home", href: "#kit-home" },
  { id: "inbox", label: "Inbox", href: "#kit-inbox", count: 3 },
  { id: "chat", label: "Chat", href: "#kit-chat" },
  { id: "usage", label: "Usage", href: "#kit-usage" },
  { id: "browsers", label: "Browsers", href: "#kit-browsers" },
];

interface AgentRow {
  id: string;
  task: string;
  model: string;
  tokens: number;
  cost: number;
  minutes: number;
}
const agentRows = (n: number): AgentRow[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `a${i}`,
    task: `LIN-${100 + i} ${["Small briefs", "Token pack", "Answer button", "Usage and spend"][i % 4]}`,
    model: ["model-top", "model-code", "model-mid"][i % 3]!,
    tokens: 12_000 + ((i * 7919) % 2_400_000),
    cost: ((i * 37) % 900) / 10 + 0.2,
    minutes: 3 + ((i * 13) % 140),
  }));

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mt-10 md:mt-12">
    <h2 className="mb-3 text-sm font-medium text-fg3">{title}</h2>
    {children}
  </section>
);

const AGENTS_3 = agentRows(3);
const AGENTS_200 = agentRows(200);

const AgentTable = memo(function AgentTable({ rows }: { rows: AgentRow[] }) {
  return (
    <DataTable
      label={`Agents, ${rows.length} rows`}
      rows={rows}
      card={["tokens", "cost"]}
      columns={[
        { key: "task", label: "Task" },
        { key: "model", label: "Model" },
        { key: "tokens", label: "Tokens", unit: "tokens", num: true },
        { key: "cost", label: "Cost", unit: "$", num: true, show: (r) => dollars(r.cost).slice(1) },
        { key: "minutes", label: "Running", unit: "min", num: true },
      ]}
      details={(r) => (
        <>
          {r.task} runs on {r.model}: {count(r.tokens)} tokens so far.
        </>
      )}
    />
  );
});

function ListDemo() {
  const [list, setList] = useState([{ id: 1 }, { id: 2 }, { id: 3 }]);
  const [gone, setGone] = useState<number[]>([]);
  const [next, setNext] = useState(4);
  return (
    <div data-list-demo>
      <div className="mb-3 flex gap-2">
        <Button quiet onClick={() => (setList((l) => [{ id: next }, ...l]), setNext(next + 1))} data-testid="list-add">
          Add a row
        </Button>
        <Button quiet onClick={() => setGone((g) => [...g, list.find((x) => !g.includes(x.id))!.id])} data-testid="list-remove">
          Remove a row
        </Button>
      </div>
      <RowList label="Rows that come and go">
        {list.map((x) => (
          <Reveal key={x.id} appear={x.id >= 4} show={!gone.includes(x.id)}>
            <Row title={`Row ${x.id}`} meta="Arrives and leaves with its height" />
          </Reveal>
        ))}
      </RowList>
    </div>
  );
}

const FAIL = "The server did not answer: connection refused.";

/** The kit's own parts on the test page. Memoised: a motion elsewhere on the page does not draw them again. */
const Kit = memo(function Kit({ page, shown }: { page: PageState; shown: PartState }) {
  const ps = projects(page);
  const fail = FAIL;
  const retry = () => location.reload();
  return (
    <>
      <Section title="Kit: row, card, tile">
        <Part state={shown} label="Rows" empty={{ text: "No rows yet." }} error={fail} onRetry={retry} rows={3}>
          <div className="grid gap-4 md:grid-cols-[1fr_320px]">
            <RowList label="Rows">
              {ps.slice(0, page === "many" ? 200 : 4).map((p) => (
                <Row
                  key={p.name}
                  lead={<StateLamp state={p.broken ? "broken" : p.tasks.some((t) => t.state === "need") ? "wait" : "clear"} />}
                  title={p.name}
                  meta={`${p.tasks.length} tasks`}
                  trail={count(p.done)}
                  href="#kit"
                />
              ))}
              <Row
                title={page === "long" ? "A row with a very long title that has to be cut with an ellipsis and never wraps the row taller" : "A plain row"}
                meta="Not a link"
                trail="12:04"
              />
            </RowList>
            <div className="grid grid-cols-2 gap-3">
              <Tile label="Merged today" value={count(1234)} sub="of 1,300 steps" />
              <Tile label="Spend today" value={dollars(42.5)} sub="limit $100" />
              <Tile label="Tokens" value={count(2_400_000)} unit="tokens" />
              <Card className="p-4 text-sm text-fg2">A card holds one part.</Card>
            </div>
          </div>
        </Part>
        <p className="mt-6 mb-2 text-sm text-fg3">Lamp, in its four states</p>
        <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-fg2">
          {(Object.keys(LAMP_WORD) as LampState[]).map((l) => (
            <span key={l} className="flex items-center gap-2">
              <StateLamp state={l} label={false} /> {LAMP_WORD[l]}
            </span>
          ))}
        </div>
        <p className="mt-6 mb-2 text-sm text-fg3">A list that inserts and removes with its height</p>
        <ListDemo />
      </Section>

      <Section title="Kit: bar chart, toast, side panel, stale bar, tracks">
        <div className="grid gap-4 md:grid-cols-2">
          <Panel>
            <Part state={shown} label="Bars" empty={{ text: "No bars yet." }} error={fail} onRetry={retry} rows={2}>
              <BarChart label="Tokens per day" bars={spend.map((d) => ({ key: d.day, label: d.day.slice(5), value: Math.round(d.dollars * 20_000) }))} />
            </Part>
          </Panel>
          <Panel>
            <ParallelTracks
              lanes={[
                {
                  label: "Kit",
                  steps: [
                    { id: "U25", look: "work" },
                    { id: "U26", look: "next" },
                    { id: "U27", look: "ahead" },
                  ],
                },
                {
                  label: "Chat",
                  steps: [
                    { id: "U40", look: "done" },
                    { id: "U41", look: "wait" },
                  ],
                },
                { label: "Docs", steps: [{ id: "U7", look: "done" }] },
              ]}
            />
          </Panel>
          <div className="space-y-3">
            <StaleBar since="19:42" onRetry={() => {}} />
            <Toast message="Merged web-shop" onUndo={() => {}} className="w-fit" />
            <div data-laid className="rounded-lg border border-line bg-raised p-4">
              <LaidTrack />
            </div>
            <div className="flex justify-center rounded-lg border border-dashed border-line p-4">
              <EmptyTrack />
            </div>
          </div>
          <SidePanel title="LIN-126 One kit" onClose={() => {}}>
            <p className="text-sm text-fg2">Opened from a row. It holds one thing.</p>
          </SidePanel>
        </div>
        <div className="mt-6 flex flex-col gap-6 md:flex-row">
          <div className="h-80 overflow-hidden rounded-lg border border-line">
            <SideRail
              items={NAV}
              current="home"
              projects={ps.slice(0, 3).map((p) => ({ name: p.name, href: `#p-${p.name}`, lamp: p.broken ? "broken" : "clear" }))}
            />
          </div>
          <div className="min-w-0 flex-1 self-end overflow-hidden rounded-lg border border-line">
            <BottomBar items={NAV} current="inbox" />
          </div>
        </div>
      </Section>

      <Section title="Kit: table">
        <p className="mb-2 text-sm text-fg3">3 rows</p>
        <AgentTable rows={AGENTS_3} />
        <p className="mb-2 mt-6 text-sm text-fg3">200 rows</p>
        <AgentTable rows={AGENTS_200} />
      </Section>
    </>
  );
});

/** Answer, notices, charts, the line, projects and the Inbox. */
function LineSections({ d, page, shown }: { d: DesignState; page: PageState; shown: PartState }) {
  const { ps, items, setItems, typing, days, chartState } = d;
  const a = answer(ps);
  const retry = () => location.reload();
  return (
    <>
      <Section title="Answer">
        <Part state={shown} label="The answer" empty={{ text: "No line yet." }} error={FAIL} onRetry={retry} rows={1}>
          <Answer {...(a ?? { tone: "clear", text: "Line clear." })} />
        </Part>
      </Section>

      <Section title="The frame's notices">
        <div className="space-y-3" data-notices>
          <Notice trouble={{ kind: "stale", since: Date.UTC(2026, 9, 31, 14, 2) }} />
          <Notice trouble={{ kind: "lost", since: Date.UTC(2026, 9, 31, 14, 2) }} />
          <Notice trouble={{ kind: "slow", since: Date.UTC(2026, 9, 31, 14, 2) }} />
          <Notice trouble={{ kind: "stopped", since: Date.UTC(2026, 9, 31, 14, 2) }} />
          <Notice trouble={{ kind: "broken", file: "docs/ROADMAP.md", lines: ["line 14: step U9 has no 'why' field"] }} />
        </div>
      </Section>

      <Section title="Charts">
        <div className="grid gap-4 md:grid-cols-2">
          <Panel>
            <Part state={chartState} label="Spend" empty={{ text: "No spend in 14 days." }} error={FAIL} onRetry={retry} rows={2}>
              <SpendChart spend={days} />
            </Part>
          </Panel>
          <Panel>
            <Part state={shown} label="Usage" empty={{ text: "No account used today." }} error={FAIL} onRetry={retry} rows={2}>
              <UsageChart usage={usage(page)} moves={moves} />
            </Part>
          </Panel>
        </div>
      </Section>

      <Section title="The line">
        <Part state={shown} label="The line" empty={{ text: "No line yet." }} error={FAIL} onRetry={retry} rows={2}>
          <Panel>
            <TheLine
              projects={ps}
              waiting={items.length}
              writing={typing}
              accounts={usage(page)}
              inbox={Object.fromEntries(items.flatMap((i) => (i.task ? [[i.task, `#item-${i.id}`]] : [])))}
            />
          </Panel>
        </Part>
      </Section>

      <Section title="Projects">
        <Part state={shown} label="Projects" empty={{ text: "No projects yet." }} error={FAIL} onRetry={retry}>
          <div className="space-y-3">
            {ps.map((p) => (
              <ProjectCard key={p.name} p={p} />
            ))}
          </div>
        </Part>
      </Section>

      <Section title="Inbox">
        <Part state={shown} label="The Inbox" empty={{ text: "Nothing here." }} error={FAIL} onRetry={retry} rows={2}>
          <InboxList items={items} onAnswer={(it) => setItems((all) => all.filter((x) => x.id !== it.id))} />
        </Part>
      </Section>
    </>
  );
}

/** Agent browsers, settings and the chat. */
function ViewSections({ d, page, shown }: { d: DesignState; page: PageState; shown: PartState }) {
  const { bs, ms, setMs, models, setModels, talk, typing, draft, setDraft } = d;
  const retry = () => location.reload();
  return (
    <>
      <Section title="Agent browsers">
        <Part state={shown} label="The browsers" empty={{ text: "No browser is open." }} error={FAIL} onRetry={retry} rows={2}>
          <BrowserGrid items={bs} card={(b) => <BrowserCard b={b} picture={samplePictureOf(b)} href="#browsers" />} />
        </Part>
      </Section>

      <Section title="Settings">
        <Part state={shown} label="Machines" empty={{ text: "Only this machine." }} error={FAIL} onRetry={retry} rows={2}>
          <MachineList
            items={ms}
            card={(m) => (
              <MachineCard
                m={m}
                onRetry={m.local ? undefined : () => {}}
                onRemove={m.local ? undefined : () => setMs((all) => all.filter((x) => x.host !== m.host))}
              />
            )}
          />
        </Part>
        <div className="mt-4">
          <Panel>
            <Part state={shown} label="Models" empty={{ text: "No projects yet." }} error={FAIL} onRetry={retry} rows={2}>
              <div className="grid gap-4 md:grid-cols-3">
                {ROLES.map((r) => (
                  <ModelList
                    key={r}
                    role={r}
                    models={models[r]}
                    onMove={(from, to) =>
                      setModels((all) => {
                        const list = [...all[r]];
                        const [m] = list.splice(from, 1);
                        list.splice(to, 0, m!);
                        return { ...all, [r]: list };
                      })
                    }
                  />
                ))}
              </div>
            </Part>
          </Panel>
        </div>
        <div className="mt-4">
          <Part state={shown} label="Project settings" empty={{ text: "No projects yet." }} error={FAIL} onRetry={retry} rows={2}>
            <ProjectSettingsCard p={settingsSample(page).projects[0]!} onSave={() => {}} open />
          </Part>
        </div>
      </Section>

      <Section title="Chat">
        <div className="mx-auto max-w-[760px]" data-design-chat>
          <DispatcherHead state={shown === "loading" ? "loading" : typing ? "writing" : "ready"} />
          <div className="mt-6">
            <Part state={shown === "error" ? "filled" : shown} label="The chat" empty={{ text: "" }} rows={3}>
              {shown === "empty" ? (
                <ChatEmpty questions={QUESTIONS} onAsk={setDraft} />
              ) : (
                <ChatThread items={talk} onImage={() => {}}>
                  {typing && (
                    <li data-key="typing" className="mt-6">
                      <Typing doing="Checking the task list" />
                    </li>
                  )}
                </ChatThread>
              )}
            </Part>
          </div>
          <div className="mt-6">
            <Composer
              text={draft}
              onText={setDraft}
              files={chatSampleAttached(page)}
              onFiles={() => {}}
              onRemove={() => {}}
              onSend={() => setDraft("")}
              canSend={!!draft.trim()}
              note={shown === "error" ? "The server cannot be reached. It connects again by itself." : undefined}
              accept="image/*"
            />
          </div>
        </div>
      </Section>
    </>
  );
}

/** The view switch and the chat panel sliding in. */
function ViewsSection({ d, shown }: { d: DesignState; shown: PartState }) {
  const { items, view, back, showView, panelDemo, slideIn } = d;
  const retry = () => location.reload();
  return (
    <Section title="Views">
      <ViewNav
        views={VIEWS.map((v) => ({ ...v, count: v.id === "inbox" && shown === "filled" ? items.length : undefined }))}
        value={view}
        onChange={showView}
      />
      <div className="mt-3">
        <ViewFrame view={view} back={back}>
          <Panel>
            <Part state={shown} label="This view" empty={{ text: "Nothing here yet." }} error={FAIL} onRetry={retry} rows={1}>
              <p className="text-lg text-fg">{VIEWS.find((v) => v.id === view)?.label}</p>
              <p className="mt-1 text-fg2">{VIEW_TEXT[view]}</p>
            </Part>
          </Panel>
        </ViewFrame>
      </div>
      <div className="mt-3 flex h-24 justify-end overflow-hidden rounded border border-line" data-chat-open-host>
        {panelDemo && (
          <aside ref={slideIn} className="flex w-48 items-center justify-center border-l border-line bg-raised text-fg2" data-chat-open-demo>
            Chat
          </aside>
        )}
      </div>
    </Section>
  );
}

export function Design() {
  const params = new URLSearchParams(location.search);
  const page = (STATES as readonly string[]).includes(params.get("state") ?? "") ? (params.get("state") as PageState) : "filled";
  const shown: PartState = page === "empty" || page === "loading" || page === "error" ? page : "filled";
  const d = useDesignState(page, shown);
  const motions = designMotions(d);

  return (
    <main className="mx-auto max-w-[1180px] px-5 pb-16 pt-6 md:px-10 md:pt-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <img src="/brand/wordmark.svg" alt="Lineclear" className="h-7" />
        <nav className="flex flex-wrap gap-1 text-sm" aria-label="States">
          {PAGE_STATES.map((s) => (
            <a
              key={s}
              href={`?state=${s}`}
              aria-current={s === page ? "page" : undefined}
              className="rounded-sm px-2.5 py-1 text-fg2 hover:text-fg aria-[current=page]:bg-raised3 aria-[current=page]:text-fg"
            >
              {s === "long" ? "long text" : s === "many" ? "200 items" : s}
            </a>
          ))}
        </nav>
      </header>

      <p className="mt-8 text-2xl font-semibold tracking-tight text-fg">Every part of Lineclear, in every state.</p>
      <p className="mt-2 max-w-2xl text-fg2">Each button plays one motion. Every motion is under 300 ms and none runs with reduced motion.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {(Object.keys(MOTIONS) as (keyof typeof MOTIONS)[]).map((m) => (
          <Button key={m} quiet onClick={motions[m]} data-testid={m}>
            {MOTION_LABEL[m]}
          </Button>
        ))}
      </div>

      <LineSections d={d} page={page} shown={shown} />
      <ViewSections d={d} page={page} shown={shown} />
      <ViewsSection d={d} shown={shown} />

      <Kit page={page} shown={shown} />

      <Section title="Shapes and buttons">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-fg2">
          {(["queued", "work", "need", "done"] as const).map((s) => (
            <span key={s} className="flex items-center gap-2">
              <Shape state={s} size={16} /> {STATE_WORD[s]}
            </span>
          ))}
          <span className="flex items-center gap-2">
            <Stop size={16} /> broken
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button>{page === "long" ? "Merge it after the review passes and the checks are green" : "Merge"}</Button>
          <Button quiet>Not yet</Button>
        </div>
      </Section>
    </main>
  );
}
