import { type ClipboardEvent, memo, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { sizeText } from "../../src/chat-limits.ts";
import { Markdown } from "./markdown.tsx";
import { beatDots, play, reducedMotion } from "./motion.ts";
import { paint, Shapes } from "./rail.tsx";
import { DispatcherIcon, WorkerIcon } from "./roles.tsx";
import { type ChatFile, FileChip, FileIcon, Thumb } from "./chat-files.tsx";
import * as rail from "../brand/rail.ts";

// The chat with the Dispatcher: who you talk to, the thread, the typing dots, the files, and the composer.

/** One row of the thread: your words, the Dispatcher's answer, or one file. */
export interface ThreadItem {
  key: string;
  who: "you" | "dispatcher";
  text?: string;
  file?: ChatFile;
  /** Under the last row of what you sent: it is on its way, waits to go in, or did not go. */
  status?: "sending" | "waiting" | "failed";
  error?: string;
  onRetry?: () => void;
  /** A card the Dispatcher asks with: its choices as buttons. `sent` is the one chosen; `said` an answer in words. */
  question?: { choices: string[]; sent?: number; said?: string; words?: boolean /** A plan: the steps it asks you to approve. */; steps?: string[] };
  /** Sends a choice; resolves to why it failed, if it did. */
  onChoose?: (choice: number) => Promise<string | undefined>;
  /** Something the Dispatcher shows that is not words, such as a plan to approve. */
  card?: ReactNode;
  /** Shown above the words (the message it answers) and below them (reactions): a task's chat sets them. */
  above?: ReactNode;
  below?: ReactNode;
}

/** A file in the composer before it goes. */
export interface Attached {
  id: string;
  name: string;
  size: number;
  image: boolean;
  /** A picture of it on this page. */
  url?: string;
  state: "uploading" | "ready" | "failed";
  error?: string;
}

export type DispatcherState = "loading" | "ready" | "writing" | "offline" | "none";

export { sizeText };

const HEAD_LINE: Record<DispatcherState, string> = {
  loading: "Connecting",
  ready: "Answers about every project",
  writing: "Writing",
  offline: "Offline",
  none: "Not set up",
};

/** Who you talk to: the Dispatcher, drawn as the signal box, and what it does now. Beside a view it says nothing while it is ready. */
export function DispatcherHead({ state, beside }: { state: DispatcherState /** Beside another view, whose own title is the page's h1. */; beside?: boolean }) {
  const Title = beside ? "h2" : "h1";
  return (
    <div className="flex items-center gap-3" data-dispatcher={state}>
      <span className="grid size-10 shrink-0 place-items-center rounded-full border border-line bg-raised">
        <DispatcherIcon size={22} className={state === "offline" || state === "none" ? "text-fg3" : "text-accent"} />
      </span>
      <div className="min-w-0">
        <Title className="text-lg font-semibold leading-6 text-fg">Dispatcher</Title>
        {!(beside && state === "ready") && (
          <p className="flex items-center gap-1.5 text-sm text-fg3">
            {state === "writing" && <span className="size-1.5 rounded-full bg-caution" aria-hidden="true" />}
            {HEAD_LINE[state]}
          </p>
        )}
      </div>
    </div>
  );
}

/** Three grey dots while the Dispatcher writes, one rising after another, and what it does now. */
export function Typing({ doing, agent }: { doing?: string /** A task's agent writes, not the Dispatcher. */; agent?: boolean }) {
  const who = agent ? "The agent" : "The Dispatcher";
  const dots = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const host = dots.current;
    if (!host || reducedMotion()) return;
    return beatDots(() => host.children, 3);
  }, []);
  return (
    <div
      className="grid grid-cols-[24px_minmax(0,1fr)] items-center gap-3"
      data-typing
      role="status"
      aria-label={doing ? `${who} is writing: ${doing}` : `${who} is writing`}
    >
      {agent ? <WorkerIcon size={18} className="text-accent" /> : <DispatcherIcon size={18} className="text-accent" />}
      <div className="flex min-w-0 items-center gap-3">
        <span ref={dots} className="flex shrink-0 items-center gap-1 rounded-full bg-raised px-3 py-2.5" aria-hidden="true">
          {[0, 1, 2].map((d) => (
            <span key={d} className="size-1.5 rounded-full bg-fg2 opacity-45" />
          ))}
        </span>
        {doing && <span className="truncate text-sm text-fg3">{doing}</span>}
      </div>
    </div>
  );
}

const STATUS: Record<NonNullable<ThreadItem["status"]>, string> = {
  sending: "Sending",
  waiting: "Sent. It goes in once the Dispatcher is ready.",
  failed: "Not sent.",
};

// one row draws again only when its own message changes, so typing does not parse every answer again
const Row = memo(function Row({
  item,
  first,
  agent,
  onImage,
}: {
  item: ThreadItem;
  first: boolean;
  agent?: boolean;
  onImage: (src: string, alt: string) => void;
}) {
  const status = item.status && (
    <p className={`mt-1 text-right text-xs ${item.status === "failed" ? "text-caution" : "text-fg3"}`} data-status={item.status}>
      {STATUS[item.status]}
      {item.error ? ` ${item.error}` : ""}
      {item.onRetry && (
        <button
          type="button"
          onClick={item.onRetry}
          className="ml-2 rounded-sm font-medium text-fg underline underline-offset-2 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
          data-retry
        >
          Try again
        </button>
      )}
    </p>
  );
  if (item.who === "you") {
    return (
      <div className="flex flex-col items-end">
        {item.above}
        {item.file ? (
          item.file.image ? (
            <Thumb file={item.file} onOpen={onImage} />
          ) : (
            <div className="max-w-[85%] sm:max-w-[60%]">
              <FileChip file={item.file} />
            </div>
          )
        ) : (
          <div
            className={`w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-lg rounded-br-sm px-4 py-2.5 text-sm text-fg sm:max-w-[70%] ${item.status === "failed" ? "bg-raised2 text-fg2" : "bg-raised3"}`}
          >
            {item.text}
          </div>
        )}
        {status}
        {item.below}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[24px_minmax(0,1fr)] gap-3">
      <span className="pt-1">{first && (agent ? <WorkerIcon size={18} className="text-accent" /> : <DispatcherIcon size={18} className="text-accent" />)}</span>
      <div className="min-w-0 text-sm">
        {item.above}
        {item.card ??
          (item.file ? (
            item.file.image ? (
              <Thumb file={item.file} onOpen={onImage} />
            ) : (
              <FileChip file={item.file} />
            )
          ) : (
            <Markdown text={item.text ?? ""} onImage={onImage} />
          ))}
        {item.question && <Choices question={item.question} onChoose={item.onChoose} />}
        {item.below}
      </div>
    </div>
  );
});

/** The choices of a card the Dispatcher asks with. Once one is sent, it stays marked and the card takes no other. */
function Choices({ question, onChoose }: { question: NonNullable<ThreadItem["question"]>; onChoose?: ThreadItem["onChoose"] }) {
  const [picked, setPicked] = useState<number>();
  const [error, setError] = useState<string>();
  const sent = question.sent ?? picked;
  const answered = question.sent !== undefined || question.said !== undefined;
  return (
    <div className="mt-3" data-choices={answered ? "answered" : "open"}>
      {question.steps && (
        <ul className="mb-3 space-y-1 rounded-lg border border-line bg-raised px-3 py-2 text-sm text-fg2 [overflow-wrap:anywhere]" data-plan-steps>
          {question.steps.map((st) => (
            <li key={st}>{st}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {question.choices.map((c, i) => (
          <button
            key={`${i}-${c}`}
            type="button"
            disabled={answered || picked !== undefined || !onChoose || question.words}
            aria-pressed={sent === i}
            onClick={() => {
              setPicked(i);
              setError(undefined);
              void onChoose?.(i).then((e) => {
                if (e) setPicked(undefined), setError(e);
              });
            }}
            className={`inline-flex min-h-11 max-w-full items-center rounded-sm px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-accent ${
              sent === i
                ? "bg-action text-base"
                : answered || picked !== undefined || question.words
                  ? "bg-raised2 text-fg3"
                  : "bg-raised2 text-fg hover:bg-raised3"
            }`}
            data-choice={i}
          >
            <span className="truncate">{c}</span>
          </button>
        ))}
      </div>
      {question.said !== undefined && question.sent === undefined && (
        <p className="mt-1 text-xs text-fg3">{question.said ? `Answered: ${question.said}` : "Answered."}</p>
      )}
      {question.words && !answered && <p className="mt-1 text-xs text-fg3">Write your answer below.</p>}
      {error && (
        <p className="mt-1 text-xs text-caution" role="status">
          {error}
        </p>
      )}
    </div>
  );
}

// the Dispatcher's line out of the box, the switch onto the project's track, and the train on it
const HANDOFF: rail.Shape[] = [
  ...rail.rail("M14 9H40C56 9 56 21 72 21H128", paint, { w: 2, tie: "line" }),
  ...rail.rail("M40 9H128", paint, { w: 2, tie: "line", ink: "line" }),
  rail.at(4, 9, rail.signalBox(paint, { w: 20, h: 13 })),
  rail.at(104, 21, rail.train("work", paint, { w: 22, h: 10 })),
];

/** A request the Dispatcher handed on: drawn going from the signal box onto its project's track. */
export function Handoff({ project, href, children }: { project: string; href?: string; children?: ReactNode }) {
  return (
    <a
      href={href ?? `/${encodeURIComponent(project)}/roadmap`}
      className="group mt-3 flex w-fit max-w-full items-center gap-3 rounded-lg border border-line px-3 py-2 hover:border-line2"
      data-handoff={project}
    >
      <svg width="132" height="28" viewBox="-6 0 138 28" aria-hidden="true" className="shrink-0 overflow-visible">
        <Shapes shapes={HANDOFF} />
      </svg>
      <span className="min-w-0 truncate text-sm text-fg2 group-hover:text-fg">
        {children ?? (
          <>
            Handed on to <span className="font-medium text-fg">{project}</span>
          </>
        )}
      </span>
    </a>
  );
}

/**
 * The thread, oldest first. A message that arrives after the first draw slides in (`chat-arrive`); what was there
 * at first is drawn at once.
 */
export function ChatThread({
  items,
  onImage,
  agent,
  children,
}: {
  items: ThreadItem[];
  onImage: (src: string, alt: string) => void /** The other side is a task's agent, not the Dispatcher. */;
  agent?: boolean;
  children?: ReactNode;
}) {
  const list = useRef<HTMLOListElement>(null);
  const seen = useRef<Set<string> | null>(null);
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const rows = [...el.querySelectorAll<HTMLElement>(":scope > [data-key]")];
    if (seen.current) {
      for (const r of rows) {
        if (seen.current.has(r.dataset.key!)) continue;
        play("chat-arrive", r, [
          { transform: "translateY(12px)", opacity: 0 },
          { transform: "none", opacity: 1 },
        ]);
      }
    }
    seen.current = new Set(rows.map((r) => r.dataset.key!));
  });
  // the thread is the view's one section, so a plan card (h3) and a reply's headings sit under its h2
  return (
    <>
      <h2 className="sr-only">Messages</h2>
      <ol ref={list} className="flex flex-col" data-thread aria-label="Messages">
        {items.map((it, i) => {
          const prev = items[i - 1];
          const first = !prev || prev.who !== it.who;
          return (
            <li key={it.key} data-key={it.key} data-who={it.who} className={`group/row ${i === 0 ? "" : first ? "mt-6" : "mt-2"}`}>
              <Row item={it} first={first} agent={agent} onImage={onImage} />
            </li>
          );
        })}
        {children}
      </ol>
    </>
  );
}

/** Three questions to ask the Dispatcher with one tap. */
export function ChatEmpty({ questions, onAsk, disabled }: { questions: string[]; onAsk: (q: string) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-col items-center px-2 py-10 text-center sm:py-16" data-chat-empty>
      <span className="grid size-16 place-items-center rounded-full border border-line bg-raised">
        <DispatcherIcon size={34} className="text-accent" />
      </span>
      <div className="mt-6 flex w-full max-w-md flex-col gap-2">
        {questions.map((q) => (
          <button
            key={q}
            type="button"
            disabled={disabled}
            onClick={() => onAsk(q)}
            className="min-h-11 rounded-lg border border-line bg-raised px-4 py-2.5 text-left text-sm text-fg hover:border-fg3 focus-visible:outline-2 focus-visible:outline-accent disabled:text-fg3 disabled:hover:border-line"
            data-ask
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The composer's attached files: pictures as small thumbnails, other files as chips, each with a remove button. */
function Tray({ files, onRemove }: { files: Attached[]; onRemove: (id: string) => void }) {
  if (!files.length) return null;
  const failed = files.filter((f) => f.state === "failed" && f.error);
  return (
    <div data-tray>
      <ul className="flex gap-2 overflow-x-auto px-3 pt-3" aria-label="Attached files">
        {files.map((f) => {
          const remove = (
            <button
              type="button"
              onClick={() => onRemove(f.id)}
              aria-label={`Remove ${f.name}`}
              className="grid size-6 shrink-0 place-items-center rounded-full bg-base/80 text-fg2 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M2 2l6 6M8 2 2 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          );
          const note = f.state === "uploading" ? "Attaching" : f.state === "failed" ? "Not attached" : undefined;
          return (
            <li key={f.id} className="shrink-0" data-attached={f.state}>
              {f.image && f.url && f.state !== "failed" ? (
                <div className="relative">
                  <img
                    src={f.url}
                    alt={f.name}
                    className={`size-16 rounded-sm border border-line object-cover ${f.state === "uploading" ? "opacity-50" : ""}`}
                  />
                  <span className="absolute right-1 top-1">{remove}</span>
                </div>
              ) : (
                <div
                  className={`flex h-16 w-56 max-w-[70vw] flex-col justify-center gap-0.5 rounded-sm border bg-raised px-3 ${f.state === "failed" ? "border-caution/60" : "border-line"}`}
                >
                  <div className="flex items-center gap-2">
                    <FileIcon />
                    <span className="min-w-0 flex-1 truncate text-sm text-fg" title={f.name}>
                      {f.name}
                    </span>
                    {remove}
                  </div>
                  <span className={`truncate text-xs ${f.state === "failed" ? "text-caution" : "text-fg3"}`}>{note ?? sizeText(f.size)}</span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {failed.map((f) => (
        <p key={f.id} className="px-3 pt-2 text-xs text-caution break-words" role="alert">
          {f.error}
        </p>
      ))}
    </div>
  );
}

/**
 * Where you write: words, files by the button, a paste or a drop, and one tap on send. Enter sends with a keyboard;
 * on a touch screen Enter is a new line and the send button sends.
 */
export function Composer({
  text,
  onText,
  files,
  onFiles,
  onRemove,
  onSend,
  canSend,
  note,
  accept,
  placeholder = "Ask the Dispatcher",
  label = "Message to the Dispatcher",
  disabled,
  replying,
}: {
  text: string;
  onText: (t: string) => void;
  files: Attached[];
  onFiles: (f: File[]) => void;
  onRemove: (id: string) => void;
  onSend: () => void;
  canSend: boolean;
  /** One line under the box: why it cannot send now. */
  note?: string;
  accept: string;
  placeholder?: string;
  label?: string;
  /** There is no one to write to: the box, the attach button and send are off. */
  disabled?: boolean;
  /** The message you answer, with the way to drop it. */
  replying?: { text: string; onCancel: () => void };
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  // the box grows with its text, up to eight lines
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 8 * 24 + 20)}px`;
  }, [text]);
  const paste = (e: ClipboardEvent) => {
    const pasted = [...e.clipboardData.files];
    if (!pasted.length) return;
    e.preventDefault();
    onFiles(pasted);
  };
  return (
    <form
      className="rounded-lg border border-line bg-raised focus-within:border-fg3"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSend();
      }}
      data-composer
    >
      {replying && (
        <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-sm text-fg3" data-replying>
          <span className="min-w-0 flex-1 truncate">Replying to: {replying.text}</span>
          <button
            type="button"
            onClick={replying.onCancel}
            className="grid size-9 shrink-0 place-items-center rounded-sm hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
            aria-label="Drop the reply"
            data-reply-cancel
          >
            ×
          </button>
        </div>
      )}
      <Tray files={files} onRemove={onRemove} />
      <div className="flex items-end gap-1 p-1.5">
        <button
          type="button"
          onClick={() => picker.current?.click()}
          disabled={disabled}
          className="grid size-11 shrink-0 place-items-center rounded-sm text-fg2 hover:bg-raised3 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 disabled:hover:bg-transparent"
          aria-label="Attach files"
          data-attach
        >
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <path
              d="M15.5 9.25 9.6 15.15a3.6 3.6 0 0 1-5.1-5.1l6.3-6.3a2.4 2.4 0 0 1 3.4 3.4l-6.2 6.2a1.2 1.2 0 0 1-1.7-1.7l5.6-5.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          accept={accept}
          className="hidden"
          data-picker
          onChange={(e) => {
            const picked = [...(e.target.files ?? [])];
            e.target.value = "";
            if (picked.length) onFiles(picked);
          }}
        />
        <textarea
          ref={box}
          value={text}
          rows={1}
          disabled={disabled}
          onChange={(e) => onText(e.target.value)}
          onPaste={paste}
          onKeyDown={(e) => {
            const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !touch) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
          placeholder={placeholder}
          aria-label={label}
          className="min-h-11 min-w-0 flex-1 resize-none bg-transparent px-2 py-2.5 text-base leading-6 text-fg outline-none placeholder:text-fg3"
          data-message-box
        />
        <button
          type="submit"
          disabled={!canSend}
          className="grid size-11 shrink-0 place-items-center rounded-sm bg-action text-base hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:bg-raised3 disabled:text-fg3 disabled:hover:brightness-100"
          aria-label="Send"
          data-send
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M9 14.5v-11M4 8l5-4.5L14 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {note && (
        <p className="px-3 pb-2 text-xs text-fg3" data-composer-note>
          {note}
        </p>
      )}
    </form>
  );
}

/**
 * Keeps a bottom bar above a phone's keyboard: the height the keyboard covers, from the visual viewport, while
 * something you type in has the focus.
 */
export function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const read = () => {
      const typing = document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLInputElement;
      setInset(typing ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0);
    };
    vv.addEventListener("resize", read);
    vv.addEventListener("scroll", read);
    addEventListener("focusin", read);
    addEventListener("focusout", read);
    read();
    return () => {
      vv.removeEventListener("resize", read);
      vv.removeEventListener("scroll", read);
      removeEventListener("focusin", read);
      removeEventListener("focusout", read);
    };
  }, []);
  return inset;
}
