import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ago, Button, exact, InboxChecks, type InboxItem, ReasonForm, reveal, SignalPic, Toast } from "../kit/index.ts";

// The strip at the top of Home: the first ask that waits for the owner, who asks, in which project and step, its
// answers as buttons, and a count that opens the rest in place, grouped by project. The same ask shows in its task's open row.

/** How long an answer can be taken back before it is sent. */
const UNDO_MS = 5000;

type Held = { item: InboxItem; choice: string };

/**
 * Answers wait UNDO_MS before they are sent. A held ask is out of `open` at once and `held` names it, so its strip can
 * turn green and leave; Undo puts it back.
 */
export function useHeldAnswers(items: InboxItem[], send: (item: InboxItem, choice: string, note?: string) => void) {
  const [held, setHeld] = useState<Held & { note?: string }>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // a second answer sends the first at once: only one can be taken back
  const flush = useRef<() => void>(undefined);
  // leaving Home sends the held answer: the toast said it was sent
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      flush.current?.();
    },
    [],
  );
  const choose = (item: InboxItem, choice: string, note?: string) => {
    clearTimeout(timer.current);
    flush.current?.();
    const send1 = () => {
      flush.current = undefined;
      setHeld((h) => (h?.item.id === item.id ? undefined : h));
      send(item, choice, note);
    };
    flush.current = send1;
    setHeld({ item, choice, note });
    timer.current = setTimeout(send1, UNDO_MS);
  };
  const undo = () => {
    clearTimeout(timer.current);
    flush.current = undefined;
    setHeld(undefined);
  };
  return { open: items.filter((i) => i.id !== held?.item.id), held, choose, undo };
}

/** Who asks: the role behind the ask's kind, else the task's agent. */
const asker = (i: InboxItem) => (i.kind === "plan" ? "Planner" : i.kind === "release" ? "Release" : i.task ? "Agent" : "Dispatcher");

const BUTTON = "min-h-9 rounded-sm bg-raised2 px-3 text-sm text-fg hover:bg-raised3 focus-visible:outline-2 focus-visible:outline-accent";

const LINK = "text-sm text-caution underline decoration-caution/40 underline-offset-4 hover:decoration-caution";

/** What else an ask holds: the browser a login waits in, the chat of a task that waits on its own, and its details. */
function Extras({ item }: { item: InboxItem }) {
  return (
    <>
      {item.session && (
        <a href={`/browsers/${encodeURIComponent(item.session)}`} className={`block truncate ${LINK}`} data-session-link={item.session}>
          Open its browser, {item.session}
        </a>
      )}
      {item.waiting &&
        (item.machine ? (
          <span className="block text-sm text-fg2">
            Answer {item.task} in its chat on {item.machine}.
          </span>
        ) : (
          <a href={`/task/${encodeURIComponent(item.task ?? "")}`} className={`block truncate ${LINK}`} data-chat-link={item.task}>
            Answer {item.task} in its chat
          </a>
        ))}
      <InboxChecks checks={item.stepChecks} />
      {item.details && (
        <details className="text-sm text-fg3">
          <summary className="cursor-pointer hover:text-fg">Details</summary>
          <p className="mt-1 whitespace-pre-wrap break-words text-fg2">{item.details}</p>
        </details>
      )}
    </>
  );
}

/** An ask's answers as buttons; the one that needs a reason opens a box for it. */
function Answers({ item, onChoose }: { item: InboxItem; onChoose: (item: InboxItem, choice: string, note?: string) => void }) {
  const [asking, setAsking] = useState(false);
  if (item.choices.length === 0) {
    return item.task ? (
      <a href={`/inbox/${encodeURIComponent(item.id)}`} className={`${BUTTON} py-1.5`}>
        Open
      </a>
    ) : null;
  }
  return (
    <>
      {item.choices.map((c, i) => (
        <Button key={c} quiet={i > 0} onClick={() => (c === item.needsNote ? setAsking(true) : onChoose(item, c))}>
          {c}
        </Button>
      ))}
      {asking && item.needsNote && (
        <ReasonForm label={item.needsNote} className="basis-full" onSend={(note) => onChoose(item, item.needsNote as string, note)} />
      )}
    </>
  );
}

/** One ask's strip. It drops in with its height when `arrive`, and when `leaving` its lamp is green and it takes its height away. */
function Ask({
  item,
  arrive,
  leaving,
  onLeft,
  more,
  marked,
  error,
  onChoose,
  onMore,
  moreOpen,
}: {
  item: InboxItem;
  arrive: boolean;
  leaving?: boolean;
  /** Called when the leaving motion has ended. */
  onLeft?: () => void;
  more: number;
  marked: boolean;
  error?: string;
  onChoose: (item: InboxItem, choice: string, note?: string) => void;
  onMore: () => void;
  moreOpen: boolean;
}) {
  const box = useRef<HTMLElement>(null);
  // the motion is decided when the strip is drawn: a later change of `arrive` must not play it
  const arrives = useRef(arrive);
  useLayoutEffect(() => {
    const el = box.current;
    if (el && arrives.current) reveal(el, 0, el.offsetHeight);
  }, []);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !leaving) return;
    // the lamp is green at once; the strip's height goes with it, and it unmounts when it is gone
    reveal(el, el.offsetHeight, 0, onLeft);
  }, [leaving]);
  const where = [item.project, item.task && (item.title ? `${item.task} ${item.title}` : item.task)].filter(Boolean).join(" · ");
  return (
    <section
      ref={box}
      aria-label="Waits for you"
      aria-hidden={leaving || undefined}
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-raised px-4 py-3 ${marked ? "border-caution" : "border-caution/50"} ${leaving ? "pointer-events-none" : ""}`}
      data-inbox-strip={leaving ? "leaving" : ""}
      data-inbox-signal={leaving ? "clear" : "caution"}
    >
      <span className="shrink-0" aria-hidden="true">
        <SignalPic aspect={leaving ? "clear" : "caution"} size={26} />
      </span>
      <span className="min-w-0 flex-1 basis-60">
        <span className="block truncate text-xs text-fg3" data-inbox-where title={where}>
          {where}
          <span data-inbox-who>{` · ${asker(item)}`}</span>
          {item.since && <span data-inbox-age title={exact(item.since)}>{` · ${ago(Date.parse(item.since))} ago`}</span>}
        </span>
        <span className="block break-words text-sm text-fg">{item.question}</span>
        <Extras item={item} />
        {error && (
          <span className="block break-words text-sm text-fg2" role="status">
            {error}
          </span>
        )}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <Answers item={item} onChoose={onChoose} />
        {more > 0 && (
          <button
            type="button"
            onClick={onMore}
            aria-expanded={moreOpen}
            className="min-h-9 px-1 text-sm tabular-nums text-fg2 underline underline-offset-4"
            data-inbox-more
          >
            +{more}
          </button>
        )}
      </span>
    </section>
  );
}

/** The rest of the asks, a row per project; a project opens to its asks. */
function More({ items, onChoose }: { items: InboxItem[]; onChoose: (item: InboxItem, choice: string, note?: string) => void }) {
  const groups = Map.groupBy(items, (i) => i.project);
  const [openProject, setOpenProject] = useState<string>();
  return (
    <ul className="grid gap-1 rounded-lg border border-line bg-raised p-2" data-inbox-rest>
      {[...groups].map(([project, asks]) => (
        <li key={project} className="min-w-0" data-inbox-group={project}>
          <button
            type="button"
            onClick={() => setOpenProject(openProject === project ? undefined : project)}
            aria-expanded={openProject === project}
            className="flex min-h-9 w-full items-center gap-3 rounded-sm px-2 text-left text-sm hover:bg-raised2"
          >
            <span className="min-w-0 flex-1 truncate text-fg">{project}</span>
            <span className="tabular-nums text-fg2">{asks.length}</span>
          </button>
          {openProject === project && (
            <ul className="mt-1 grid max-h-96 gap-2 overflow-auto px-2 pb-2">
              {asks.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5" data-inbox-ask={a.id}>
                  <span className="min-w-0 flex-1 basis-60">
                    <span className="block truncate text-xs text-fg3" title={a.since ? exact(a.since) : undefined}>
                      {a.task && (a.title ? `${a.task} ${a.title}` : a.task)} · {asker(a)}
                      {a.since && ` · ${ago(Date.parse(a.since))} ago`}
                    </span>
                    <span className="block break-words text-sm text-fg">{a.question}</span>
                  </span>
                  <span className="flex flex-wrap gap-2">
                    <Answers item={a} onChoose={onChoose} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The strip: shown only while something waits, or while the answered one leaves. */
export function InboxStrip({
  open,
  held,
  onChoose,
  onUndo,
  ask,
  errors,
  read,
}: {
  open: InboxItem[];
  held?: Held;
  onChoose: (item: InboxItem, choice: string, note?: string) => void;
  onUndo: () => void;
  /** The ask an address names: it goes first. */
  ask?: string;
  errors: Record<string, string>;
  /** Whether the asks were read: the ones that come with the first read are simply there. */
  read: boolean;
}) {
  const [more, setMore] = useState(false);
  // what arrives after the first read drops in; the first read is simply there
  const [settled, setSettled] = useState(false);
  useEffect(() => setSettled(read), [read]);
  const named = open.find((i) => i.id === ask || i.task === ask);
  const ordered = named ? [named, ...open.filter((i) => i !== named)] : open;
  const first = ordered[0];
  const rest = ordered.slice(1);
  // the answered strip stays until its motion ends
  const [gone, setGone] = useState<InboxItem>();
  useEffect(() => {
    if (held) setGone(held.item);
    else setGone(undefined);
  }, [held]);
  return (
    <>
      {gone && (
        <Ask
          key={`gone-${gone.id}`}
          item={gone}
          arrive={false}
          leaving
          onLeft={() => setGone(undefined)}
          more={0}
          marked={false}
          onChoose={onChoose}
          onMore={() => {}}
          moreOpen={false}
        />
      )}
      {first && (
        <Ask
          key={first.id}
          item={first}
          arrive={settled}
          more={rest.length}
          marked={first.id === ask || first.task === ask}
          error={errors[first.id]}
          onChoose={onChoose}
          onMore={() => setMore(!more)}
          moreOpen={more}
        />
      )}
      {first && more && rest.length > 0 && <More items={rest} onChoose={onChoose} />}
      {held && <Toast message={`Sent: ${held.choice}`} onUndo={onUndo} />}
    </>
  );
}

/** The ask of a task, in the task's open row: its question and answers, the same ask as the strip's. */
export function AskInRow({ item, onChoose }: { item: InboxItem; onChoose: (item: InboxItem, choice: string, note?: string) => void }) {
  return (
    <section className="min-w-0 lg:col-span-2" aria-label="Ask" data-row-ask={item.id}>
      <h3 className="mb-1 text-xs font-medium text-fg3">Waits for you</h3>
      <p className="mb-2 break-words text-fg">{item.question}</p>
      <Extras item={item} />
      <div className="flex flex-wrap gap-2">
        <Answers item={item} onChoose={onChoose} />
      </div>
    </section>
  );
}
