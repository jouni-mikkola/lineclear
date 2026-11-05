import { KEY } from "../brand/rail.ts";
import { Collapsible } from "@base-ui/react/collapsible";
import { Input } from "@base-ui/react/input";
import { useLayoutEffect, useRef, useState } from "react";
import { ago, exact } from "./format.ts";
import { play, playKey } from "./motion.ts";
import { SignalPic } from "./rail.tsx";
import { RichText } from "./rich-text.tsx";
import { RoleIcon, type RoleName } from "./roles.tsx";
import { InboxChecks } from "./cold-read.tsx";
import { Button, useFlip } from "./parts.tsx";

export interface InboxItem {
  id: string;
  project: string;
  question: string;
  choices: string[];
  details?: string;
  /** The answer that needs a reason with it, such as rejecting a plan. */
  needsNote?: string;
  /** For a login or a code: the agent's browser session, to open on the Agent browsers view. */
  session?: string;
  /** The task that asked or waits, and its title. */
  task?: string;
  title?: string;
  result?: string;
  machine?: string; // when the task runs on another machine: its chat lives there
  /** Since when it waits (ISO time): the card shows its age. */
  since?: string;
  /** For a plan: the go of each step a fresh model read cold, with its words. A no-go is never here. */
  stepChecks?: { step: string; model: string; said: string }[];
  /** What it asks about, such as "plan" from the planner; its role's icon shows on the card. */
  kind?: string;
  waiting?: true; // a task that waits with no item: answered in its chat, /task/<id>
}

/** Who asks: the planner for a plan, the task's worker for a task, else the Dispatcher. */
const askerRole = (i: InboxItem): RoleName => (i.kind === "plan" ? "planner" : i.task ? "worker" : "dispatcher");

const CARD = "rounded-lg bg-raised/60 p-4 md:p-5";

/** The reason a choice needs, asked in place: a field and the button that sends it with the answer. */
export function ReasonForm({
  label,
  className,
  onSend,
  onCancel,
}: {
  label: string;
  className: string;
  onSend: (note: string) => void;
  onCancel?: () => void;
}) {
  const [note, setNote] = useState("");
  return (
    <form
      className={`flex flex-wrap items-center gap-2 ${className}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (note.trim()) onSend(note.trim());
      }}
    >
      <Input
        value={note}
        onValueChange={setNote}
        placeholder={`Why? (${label})`}
        aria-label={`Why: ${label}`}
        autoFocus
        className="min-h-9 min-w-0 flex-1 basis-60 rounded-sm border border-line bg-base px-3 text-sm text-fg placeholder:text-fg3"
      />
      <Button submit>{label}</Button>
      {onCancel && (
        <Button quiet onClick={onCancel}>
          Cancel
        </Button>
      )}
    </form>
  );
}

/**
 * One Inbox item: its question, its answers as buttons, and its details behind one click. An answer that needs a
 * reason asks for it in the card itself. Its signal is amber while it waits for you: an answer turns it green at
 * once, it pulses, and then the item leaves.
 */
/** `level` is the question's heading level: 2 straight under the page title, 3 under a section. */
export function InboxCard({
  item,
  onAnswer,
  error,
  level = 3,
}: {
  item: InboxItem;
  onAnswer?: (choice: string, note?: string) => void;
  error?: string;
  level?: 2 | 3;
}) {
  const Question = `h${level}` as const;
  const [asking, setAsking] = useState(false);
  const [clear, setClear] = useState(false);
  const signal = useRef<HTMLSpanElement>(null);
  // one answer at a time: a second tap while the signal turns sends nothing
  const sent = useRef(false);
  // an answer that did not reach the server holds the signal amber again and takes a new answer
  useLayoutEffect(() => {
    if (!error) return;
    sent.current = false;
    setClear(false);
  }, [error]);
  const answer = (choice: string, why?: string) => {
    if (sent.current) return;
    sent.current = true;
    setClear(true);
    // the lamp turns from amber to green while the signal pulses
    const lamp = signal.current?.querySelector("[data-lamp]");
    if (lamp) playKey("lamp", "inbox-clear", lamp, KEY.lamp.frames);
    const a = signal.current && play("inbox-clear", signal.current, [{ transform: "none" }, { transform: "scale(1.35)", offset: 0.4 }, { transform: "none" }]);
    if (!a) return onAnswer?.(choice, why);
    const go = () => onAnswer?.(choice, why);
    a.finished.then(go, go);
  };
  return (
    <div className={CARD} data-inbox-signal={clear ? "clear" : "caution"} data-inbox-card>
      <div className="flex min-w-0 items-center gap-2 text-xs text-fg3">
        <span ref={signal} className="shrink-0" aria-hidden="true" data-held>
          <SignalPic aspect={clear ? "clear" : "caution"} size={26} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate" data-inbox-project title={item.project}>
            <RoleIcon role={askerRole(item)} size={13} hidden className="mr-1.5 inline align-[-2px]" />
            {item.project}
            {item.since && <span data-inbox-age title={exact(item.since)}>{` · ${ago(Date.parse(item.since))}`}</span>}
          </span>
          {item.task && (
            <span className="block truncate text-sm text-fg2" data-inbox-task title={`${item.task} ${item.title ?? ""}`}>
              <span className="text-fg3 tabular-nums">{item.task}</span>
              {item.title && ` ${item.title}`}
            </span>
          )}
          {item.task && item.result && (
            <span className="block truncate text-xs text-fg3" data-inbox-result>
              {item.result}
            </span>
          )}
        </span>
      </div>
      <Question className="mt-1.5 break-words text-base font-medium text-fg">
        <RichText text={item.question} />
      </Question>
      <div className="mt-2 empty:hidden">
        <InboxChecks checks={item.stepChecks} />
      </div>
      {item.session && (
        <a
          href={`/browsers/${encodeURIComponent(item.session)}`}
          className="mt-2 inline-flex max-w-full items-center gap-1.5 text-sm text-caution underline decoration-caution/40 underline-offset-4 hover:decoration-caution"
          data-session-link={item.session}
        >
          <span className="truncate">Open its browser, {item.session}</span>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="shrink-0">
            <path d="M3 1.5 6.5 5 3 8.5" stroke="currentColor" strokeWidth="1.6" fill="none" />
          </svg>
        </a>
      )}
      {item.waiting && (
        <p className="mt-3 text-sm text-fg2">
          {item.machine ? (
            `Answer ${item.task} in its chat on ${item.machine}.`
          ) : (
            <a
              data-inline
              href={`/task/${item.task}`}
              className="text-caution underline decoration-caution/40 underline-offset-4 hover:decoration-caution"
              data-chat-link={item.task}
            >
              Answer {item.task} in its chat
            </a>
          )}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {item.choices.map((c, i) => (
          <Button key={c} quiet={i > 0} onClick={() => (c === item.needsNote ? setAsking(true) : answer(c))}>
            <span className="truncate">{c}</span>
          </Button>
        ))}
      </div>
      {asking && item.needsNote && (
        <ReasonForm label={item.needsNote} className="mt-3" onSend={(note) => answer(item.needsNote as string, note)} onCancel={() => setAsking(false)} />
      )}
      {error && (
        <p className="mt-3 break-words text-sm text-fg" role="status">
          {error}
        </p>
      )}
      {item.details && (
        <Collapsible.Root className="mt-3">
          <Collapsible.Trigger className="text-sm text-fg3 hover:text-fg">Details</Collapsible.Trigger>
          <Collapsible.Panel>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-fg2">
              <RichText text={item.details} />
            </p>
          </Collapsible.Panel>
        </Collapsible.Root>
      )}
    </div>
  );
}

const INBOX_SHOWN = 20;

/** The Inbox's items, newest first. A new item drops in at the top and the rest slide down. */
export function InboxList({
  items,
  onAnswer,
  errors,
  current,
  level,
}: {
  items: InboxItem[];
  level?: 2 | 3;
  onAnswer?: (item: InboxItem, choice: string, note?: string) => void;
  errors?: Record<string, string>;
  /** The ask an address names: marked with `aria-current` and a ring. */
  current?: string;
}) {
  const list = useRef<HTMLUListElement>(null);
  // only an arrival moves the list: an answered item leaves at once
  useFlip(list, "inbox-arrive", "inbox-arrive", undefined, true);
  const card = (it: InboxItem) => (
    <li
      key={it.id}
      id={`item-${it.id}`}
      data-key={it.id}
      aria-current={it.id === current ? "location" : undefined}
      className="min-w-0 scroll-mt-6 target:[&>*]:ring-1 target:[&>*]:ring-caution/60 aria-[current]:[&>*]:ring-1 aria-[current]:[&>*]:ring-caution/60"
    >
      <InboxCard item={it} onAnswer={(c, note) => onAnswer?.(it, c, note)} error={errors?.[it.id]} level={level} />
    </li>
  );
  return (
    <div>
      <ul ref={list} className="relative grid gap-3" data-inbox>
        {items.slice(0, INBOX_SHOWN).map(card)}
      </ul>
      {items.length > INBOX_SHOWN && (
        <Collapsible.Root className="mt-3">
          <Collapsible.Trigger className="text-sm text-fg3 hover:text-fg">{items.length - INBOX_SHOWN} more waiting</Collapsible.Trigger>
          <Collapsible.Panel>
            <ul className="mt-3 grid gap-3">{items.slice(INBOX_SHOWN).map(card)}</ul>
          </Collapsible.Panel>
        </Collapsible.Root>
      )}
    </div>
  );
}
