import { type DragEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChatView } from "../../src/chat.ts";
import type { PlanCard } from "../../src/web.ts";
import { ACCEPT, MAX_TEXT } from "../../src/chat-limits.ts";
import {
  ChatEmpty,
  ChatThread,
  Composer,
  DispatcherHead,
  type DispatcherState,
  Handoff,
  InboxCard,
  Lightbox,
  NoDispatcher,
  Part,
  type ThreadItem,
  Typing,
  useKeyboardInset,
} from "../kit/index.ts";
import { Quote, Reactions } from "../kit/task-chat.tsx";
import { TaskHead, TaskNote } from "../kit/task-head.tsx";
import { QUESTIONS } from "./samples.ts";
import type { Pending, useChat } from "./chat.tsx";

const PLAN_SAID: Record<PlanCard["state"], string> = {
  planning: "The planner writes the steps again, with your note.",
  approve: "",
  approved: "Approved. The steps are in the roadmap, and each starts when the steps before it are merged.",
  rejected: "Rejected. The roadmap stays as it was.",
  closed: "Closed. The roadmap stays as it was.",
};

/** A plan you asked for, in the chat: to approve while it waits, then what came of it, with its live link. */
function PlanInChat({ plan, error, onAnswer }: { plan: PlanCard; error?: string; onAnswer: (choice: string, note?: string) => void }) {
  const steps = plan.steps.length ? `${plan.steps.length === 1 ? "1 step" : `${plan.steps.length} steps`}: ${plan.steps.join(", ")}. ` : "";
  return (
    <div className="grid gap-2" data-plan={plan.task} data-plan-state={plan.state}>
      {plan.item ? (
        <InboxCard item={plan.item} onAnswer={onAnswer} error={error} />
      ) : (
        <p className="text-fg2">
          {steps}
          {PLAN_SAID[plan.state]}
        </p>
      )}
      <Handoff project={plan.project} href={plan.live}>
        See {plan.goal.length > 48 ? "the steps" : `"${plan.goal}"`} live in <span className="font-medium text-fg">{plan.project}</span>
      </Handoff>
    </div>
  );
}

/** The thread's rows: the chat, then what you sent that it does not have yet. */
function rows(
  view: ChatView,
  pending: Pending[],
  retry: (cid: string) => void,
  chat: Pick<ReturnType<typeof useChat>, "plans" | "planErrors" | "answerPlan" | "choose" | "react" | "setReplyTo">,
  rich: boolean,
): ThreadItem[] {
  const out: ThreadItem[] = view.messages.map((m) => ({
    key: m.id,
    who: m.who,
    text: m.text,
    file: m.file,
    ...(m.waiting ? { status: "waiting" as const } : {}),
    ...(m.question ? { question: m.question, onChoose: (i: number) => chat.choose(m.question!.id, i) } : {}),
    ...(m.reply ? { above: <Quote text={m.reply.text} /> } : {}),
    ...(rich
      ? {
          below: (
            <Reactions
              item={{
                reactions: m.reactions,
                onReact: (emoji) => void chat.react(m.id, emoji),
                onReply: () => chat.setReplyTo({ id: m.id, text: m.text ?? m.file?.name ?? "" }),
              }}
            />
          ),
        }
      : {}),
  }));
  // a plan you asked for shows after the message it came in on: the last one written before it was asked
  const placed = chat.plans
    .filter((p) => p.state !== "planning" || p.answer)
    .map((p, order) => {
      const since = Date.parse(p.since);
      let at = view.messages.length;
      for (let i = view.messages.length - 1; i >= 0; i--) {
        const m = view.messages[i]!;
        if (m.at !== undefined && m.at > since) at = i;
        else break;
      }
      return { p, at, order };
    })
    // from the end, so each place still counts the messages only; of two at one place the older goes first
    .sort((a, b) => b.at - a.at || a.order - b.order);
  for (const { p, at } of placed) {
    out.splice(at, 0, {
      key: `plan-${p.task}`,
      who: "dispatcher",
      card: <PlanInChat plan={p} error={chat.planErrors[p.task]} onAnswer={(c, note) => void chat.answerPlan(p, c, note)} />,
    });
  }
  for (const p of pending) {
    const mine: ThreadItem[] = [
      ...p.files.map((f): ThreadItem => ({ key: `${p.cid}-${f.id}`, who: "you", file: { name: f.name, size: f.size, image: f.image, url: f.url } })),
      ...(p.text ? [{ key: `${p.cid}-text`, who: "you" as const, text: p.text }] : []),
    ];
    const last = mine[mine.length - 1];
    if (last && p.status !== "sent") Object.assign(last, { status: p.status, error: p.error, onRetry: p.status === "failed" ? () => retry(p.cid) : undefined });
    out.push(...mine);
  }
  return out;
}

/** The place the thread scrolls in: the page, or the panel's own box. */
const scrollEnd = (box: HTMLElement | null) => (box ? box.scrollHeight - box.clientHeight : document.documentElement.scrollHeight);
const nearBottom = (box: HTMLElement | null) => (box ? box.scrollTop >= scrollEnd(box) - 160 : innerHeight + scrollY >= scrollEnd(null) - 160);

/** The Dispatcher's state for the head and the page: what the read says, with a lost connection as offline. */
function dispatcherState(view: ChatView | undefined, online: boolean, writing: boolean): DispatcherState {
  if (!view) return "loading";
  if (view.state !== "ready") return view.state;
  if (!online) return "offline";
  return writing ? "writing" : "ready";
}

/** Why the composer cannot send now (`cut`) and the one line under it (`note`). */
function composerNotes(chat: ReturnType<typeof useChat>, uploading: boolean, text: string) {
  const { view } = chat;
  const cut = !chat.online
    ? "You are offline. You can write, and send once the connection is back."
    : chat.lost
      ? "The server cannot be reached. It connects again by itself."
      : view?.state === "offline"
        ? view.reason
        : undefined;
  const note =
    view?.state === "none"
      ? view.reason
      : cut
        ? undefined
        : uploading
          ? "Attaching. Send works once the files are in."
          : text.length > MAX_TEXT
            ? `A message can be at most ${MAX_TEXT.toLocaleString("en")} characters.`
            : undefined;
  return { cut, note };
}

/** The newest message stays in sight: at the start, and as one comes while you read the end. Returns the flag to set when you send. */
function useStickToEnd(box: React.RefObject<HTMLDivElement | null>, items: { status?: string }[], writing: boolean, inset: number) {
  const end = useRef(true);
  const seen = useRef(0);
  useEffect(() => {
    const at = () => (end.current = nearBottom(box.current));
    const target: HTMLElement | Window = box.current ?? window;
    target.addEventListener("scroll", at, { passive: true });
    return () => target.removeEventListener("scroll", at);
  }, [box]);
  const count = items.length + (writing ? 1 : 0);
  const mine = items[items.length - 1]?.status === "sending";
  useLayoutEffect(() => {
    if (!count) return;
    const first = seen.current === 0;
    if (first || end.current || mine) {
      if (box.current) box.current.scrollTop = scrollEnd(box.current);
      else scrollTo({ top: scrollEnd(null), behavior: "instant" });
    }
    seen.current = count;
  }, [count, inset, mine, box]);
  return end;
}

/** What the thread box shows: loading, no chat, the messages, or the empty chat with its example questions. */
function ThreadBody({
  view,
  items,
  writing,
  task,
  onImage,
  onAsk,
  ready,
}: {
  view: ChatView | undefined;
  items: ReturnType<typeof rows>;
  writing: boolean;
  task?: string;
  onImage: (src: string, alt: string) => void;
  onAsk: (q: string) => void;
  ready: boolean;
}) {
  if (!view) return <Part state="loading" label="The chat" empty={{ text: "" }} rows={3} />;
  if (view.state === "none") return task ? <TaskNote text={view.reason ?? "This task has no chat."} none /> : <NoDispatcher />;
  if (!items.length && !writing)
    return task ? <TaskNote text="No messages yet. Write to its agent below." /> : <ChatEmpty questions={QUESTIONS} onAsk={onAsk} disabled={!ready} />;
  return (
    <>
      {items.length >= 200 && <p className="mb-6 text-center text-sm text-fg3">The latest 200 messages. The whole chat is on the board.</p>}
      <ChatThread items={items} onImage={onImage} agent={!!task}>
        {writing && (
          <li data-key="typing" className="mt-6">
            <Typing doing={view.doing} agent={!!task} />
          </li>
        )}
      </ChatThread>
    </>
  );
}

/** The chat as a page, or with `panel` as a box that fills the 400 px panel beside a view and scrolls inside itself. */
export function Chat({
  chat,
  panel,
  task,
}: {
  chat: ReturnType<typeof useChat>;
  panel?: boolean /** The id of the task whose agent this chat is with: it replaces the Dispatcher head and words. */;
  task?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [image, setImage] = useState<{ src: string; alt: string }>();
  const [drag, setDrag] = useState(false);
  const inset = useKeyboardInset();
  const { view, pending, attached } = chat;
  const online = chat.online && !chat.lost;
  const items = useMemo(
    () => (view ? rows(view, pending, chat.retry, chat, !!task) : []),
    [view, pending, chat.retry, chat.plans, chat.planErrors, chat.choose, chat.answerPlan, chat.react, chat.setReplyTo, task],
  );
  const onImage = useCallback((src: string, alt: string) => setImage({ src, alt }), []);
  const writing = !!view?.writing && view.state === "ready";

  const end = useStickToEnd(box, items, writing, inset);

  const state = dispatcherState(view, online, writing);
  const uploading = attached.some((a) => a.state === "uploading");
  const ready = view?.state === "ready" && online;
  const canSend = ready && !uploading && (!!text.trim() || attached.some((a) => a.state === "ready")) && text.length <= MAX_TEXT;
  const { cut, note } = composerNotes(chat, uploading, text);
  const send = () => {
    chat.send(text);
    setText("");
    end.current = true;
  };
  const ask = (q: string) => {
    chat.send(q);
    end.current = true;
  };

  const dropping = (e: DragEvent) => e.dataTransfer.types.includes("Files");
  return (
    <div
      className={
        panel
          ? "relative flex h-full min-h-0 flex-col"
          : "relative flex min-h-[calc(100dvh-140px-var(--bar-h))] flex-col md:min-h-[calc(100dvh-168px-var(--bar-h))]"
      }
      data-chat={state}
      data-chat-panel-body={panel || undefined}
      onDragOver={(e) => {
        if (!dropping(e)) return;
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false);
      }}
      onDrop={(e) => {
        if (!dropping(e)) return;
        e.preventDefault();
        setDrag(false);
        chat.attach([...e.dataTransfer.files]);
      }}
    >
      {!panel && (task ? <TaskHead id={task} state={state} /> : <DispatcherHead state={state} />)}
      <div
        ref={panel ? box : undefined}
        className={panel ? "min-h-0 w-full flex-1 overflow-y-auto px-4 pt-4" : "mx-auto mt-8 w-full max-w-[760px] flex-1"}
        data-thread-scroll={panel || undefined}
        tabIndex={panel ? 0 : undefined}
      >
        <ThreadBody view={view} items={items} writing={writing} task={task} onImage={onImage} onAsk={ask} ready={ready} />
      </div>
      <div
        className={panel ? "w-full shrink-0 bg-base px-4 pb-4 pt-2" : "sticky z-10 mx-auto mt-6 w-full max-w-[760px] bg-base pb-4 pt-2 md:pb-6"}
        style={panel ? undefined : { bottom: `calc(${inset}px + var(--bar-h))` }}
        data-composer-bar
      >
        {view && view.state !== "none" && cut && (
          <p className="mb-2 flex items-start gap-2 text-sm text-caution" role="status" data-offline>
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-caution" aria-hidden="true" />
            {cut}
          </p>
        )}
        <Composer
          text={text}
          onText={setText}
          files={attached}
          onFiles={chat.attach}
          onRemove={chat.remove}
          onSend={send}
          canSend={canSend}
          note={note}
          accept={ACCEPT}
          {...(task ? { placeholder: "Write to the agent", label: `Message to the agent of ${task}` } : {})}
          replying={chat.replyTo && { text: chat.replyTo.text, onCancel: () => chat.setReplyTo(undefined) }}
        />
      </div>
      {drag && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-lg border-2 border-dashed border-accent bg-base/85" data-drop>
          <p className="text-lg text-fg">Drop to attach</p>
        </div>
      )}
      <Lightbox image={image} onClose={() => setImage(undefined)} />
    </div>
  );
}
