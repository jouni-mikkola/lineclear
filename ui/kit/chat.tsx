import { memo, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Markdown } from "./markdown.tsx";
import { beatDots, play, reducedMotion } from "./motion.ts";
import { paint, Shapes } from "./rail.tsx";
import { DispatcherIcon, WorkerIcon } from "./roles.tsx";
import { type ChatFile, FileChip, Thumb } from "./chat-files.tsx";
import { FOCUS } from "./composer.tsx";
import * as rail from "../brand/rail.ts";

// The chat with the Dispatcher: who you talk to, the thread, the typing dots, the files, and the composer.

type OnImage = (src: string, alt: string) => void;

/**
 * One row of the thread: your words, the Dispatcher's answer, or one file. `status` sits under the last row you sent;
 * `question` is a card the Dispatcher asks with (`sent` the choice made, `said` an answer in words, `steps` a plan to approve);
 * `card` is something that is not words; `above` and `below` frame the words (the message it answers, a reply button).
 */
export interface ThreadItem {
  key: string;
  who: "you" | "dispatcher";
  text?: string;
  file?: ChatFile;
  status?: "sending" | "waiting" | "failed";
  error?: string;
  onRetry?: () => void;
  question?: { choices: string[]; sent?: number; said?: string; words?: boolean; steps?: string[] };
  /** Sends a choice; resolves to why it failed, if it did. */
  onChoose?: (choice: number) => Promise<string | undefined>;
  card?: ReactNode;
  above?: ReactNode;
  below?: ReactNode;
}

export type DispatcherState = "loading" | "ready" | "writing" | "offline" | "none";

const HEAD_LINE: Record<DispatcherState, string> = {
  loading: "Connecting",
  ready: "Answers about every project",
  writing: "Writing",
  offline: "Offline",
  none: "Not set up",
};

/** Who you talk to: the Dispatcher, drawn as the signal box, and what it does now. Beside a view (`beside`, whose own title is the h1) it says nothing while ready. */
export function DispatcherHead({ state, beside }: { state: DispatcherState; beside?: boolean }) {
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

/** The mark of who writes: the Dispatcher's signal box, or a task's agent. */
const Who = ({ agent }: { agent?: boolean }) =>
  agent ? <WorkerIcon size={18} className="text-accent" /> : <DispatcherIcon size={18} className="text-accent" />;

/** Three grey dots while the Dispatcher (or a task's `agent`) writes, one rising after another, and what it does now. */
export function Typing({ doing, agent }: { doing?: string; agent?: boolean }) {
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
      <Who agent={agent} />
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

const STATUS = { sending: "Sending", waiting: "Sent. It goes in once the Dispatcher is ready.", failed: "Not sent." };

// one row draws again only when its own message changes, so typing does not parse every answer again
const Row = memo(function Row({ item, first, agent, onImage }: { item: ThreadItem; first: boolean; agent?: boolean; onImage: OnImage }) {
  const { file, status } = item;
  const media = file && (file.image ? <Thumb file={file} onOpen={onImage} /> : <FileChip file={file} />);
  if (item.who === "dispatcher") {
    return (
      <div className="grid grid-cols-[24px_minmax(0,1fr)] gap-3">
        <span className="pt-1">{first && <Who agent={agent} />}</span>
        <div className="min-w-0 text-sm">
          {item.above}
          {item.card ?? media ?? <Markdown text={item.text ?? ""} onImage={onImage} />}
          {item.question && <Choices question={item.question} onChoose={item.onChoose} />}
          {item.below}
        </div>
      </div>
    );
  }
  const bubble = status === "failed" ? "bg-raised2 text-fg2" : "bg-raised3";
  return (
    <div className="flex flex-col items-end">
      {item.above}
      {file?.image && media}
      {file && !file.image && <div className="max-w-[85%] sm:max-w-[60%]">{media}</div>}
      {!file && (
        <div className={`w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-lg rounded-br-sm px-4 py-2.5 text-sm text-fg sm:max-w-[70%] ${bubble}`}>
          {item.text}
        </div>
      )}
      {status && (
        <p className={`mt-1 text-right text-xs ${status === "failed" ? "text-caution" : "text-fg3"}`} data-status={status}>
          {STATUS[status]}
          {item.error ? ` ${item.error}` : ""}
          {item.onRetry && (
            <button
              type="button"
              onClick={item.onRetry}
              className={`ml-2 rounded-sm font-medium text-fg underline underline-offset-2 hover:text-accent ${FOCUS}`}
              data-retry
            >
              Try again
            </button>
          )}
        </p>
      )}
      {item.below}
    </div>
  );
});

/** The choices of a card the Dispatcher asks with. Once one is sent, it stays marked and the card takes no other. */
function Choices({ question, onChoose }: { question: NonNullable<ThreadItem["question"]>; onChoose?: ThreadItem["onChoose"] }) {
  const [picked, setPicked] = useState<number>();
  const [error, setError] = useState<string>();
  const sent = question.sent ?? picked;
  const answered = question.sent !== undefined || question.said !== undefined;
  const closed = answered || picked !== undefined || !!question.words;
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
            disabled={closed || !onChoose}
            aria-pressed={sent === i}
            onClick={() => {
              setPicked(i);
              setError(undefined);
              void onChoose?.(i).then((e) => e && (setPicked(undefined), setError(e)));
            }}
            className={`inline-flex min-h-11 max-w-full items-center rounded-sm px-3 py-1.5 text-sm font-medium ${FOCUS} ${sent === i ? "bg-action text-base" : closed ? "bg-raised2 text-fg3" : "bg-raised2 text-fg hover:bg-raised3"}`}
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
 * at first is drawn at once. With `agent` the other side is a task's agent, not the Dispatcher.
 */
export function ChatThread({ items, onImage, agent, children }: { items: ThreadItem[]; onImage: OnImage; agent?: boolean; children?: ReactNode }) {
  const list = useRef<HTMLOListElement>(null);
  const seen = useRef<Set<string> | null>(null);
  useLayoutEffect(() => {
    const rows = [...(list.current?.querySelectorAll<HTMLElement>(":scope > [data-key]") ?? [])];
    for (const r of rows) {
      if (seen.current && !seen.current.has(r.dataset.key!)) {
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
          const first = items[i - 1]?.who !== it.who;
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
            className={`min-h-11 rounded-lg border border-line bg-raised px-4 py-2.5 text-left text-sm text-fg hover:border-fg3 ${FOCUS} disabled:text-fg3 disabled:hover:border-line`}
            data-ask
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
