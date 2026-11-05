import { type MouseEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { play, stop } from "./motion.ts";
import { EmptyTrack } from "./rail.tsx";
import { Shape } from "./shapes.tsx";

// The agents' browsers: a card per open session with a live picture, and the picture itself.

export interface Browser {
  session: string;
  title: string;
  task?: string;
  project?: string;
  note?: string;
  waits?: { item: string; question: string };
  page?: { title: string; url: string };
  taken: boolean;
  /** The machine it runs on, when it is not this one: it is watched and taken over there. */
  machine?: string;
}

/** A page's host, or the address as it is when it has none. */
export const hostOf = (url: string) => {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
};

/** Where a session is: its task, its project and what its name adds, or nothing when no task has it. */
export const whereOf = (b: Browser) => [b.task, b.project, b.note].filter(Boolean).join(" · ");

/** The sessions of a task, or that wait for you, first; the rest fold under Other sessions. */
export const splitSessions = (all: Browser[]) => ({ tasks: all.filter((b) => b.task || b.waits), other: all.filter((b) => !b.task && !b.waits) });

/** A page drawn in outline, with its host, until the first picture of it comes. */
function PicturePlaceholder({ host, failed }: { host?: string; failed: boolean }) {
  return (
    <div className="absolute inset-0 flex flex-col bg-raised" aria-label={failed ? "No picture yet" : "The picture is loading"} data-placeholder>
      <div className="flex h-[12%] items-center gap-1.5 border-b border-line px-3">
        <span className="size-1.5 rounded-full bg-line" />
        <span className="size-1.5 rounded-full bg-line" />
        <span className="size-1.5 rounded-full bg-line" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
        <Globe />
        {host && <span className="max-w-full truncate text-sm text-fg2">{host}</span>}
        {failed && <span className="text-xs text-fg3">No picture yet.</span>}
      </div>
    </div>
  );
}

const Globe = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className="shrink-0 text-fg3">
    <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.3" fill="none" />
    <path d="M1.75 8h12.5M8 1.75c2 2.2 2 10.3 0 12.5M8 1.75c-2 2.2-2 10.3 0 12.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
  </svg>
);

/** The last picture read per address, so a view that opens shows what the last one showed at once. */
const kept = new Map<string, Blob>();
const keep = (src: string, blob: Blob) => {
  kept.delete(src);
  kept.set(src, blob);
  if (kept.size > 60) kept.delete(kept.keys().next().value!);
};

/**
 * A live picture of a browser: the server's JPEG, read again every `every` ms while the page shows. The next
 * picture is decoded before it replaces the last, so it never flickers. A `data:` source is a still picture.
 * With a `poster` (a smaller picture of the same page) a view opens on the last picture read, and reads fast at first.
 * `fit="whole"` shows all of it, and `onPoint` then hears where it was clicked, in the browser's own pixels.
 */
export function LivePicture({
  src,
  poster,
  every,
  alt,
  fit = "cover",
  host,
  onPoint,
}: {
  src: string;
  /** A smaller picture of the same page (a card's), shown at once when `src` has none kept yet; `src` swaps in behind it. */
  poster?: string;
  every: number;
  alt: string;
  fit?: "cover" | "whole";
  /** The page's host, shown on the placeholder until the first picture comes. */
  host?: string;
  onPoint?: (x: number, y: number) => void;
}) {
  const still = src.startsWith("data:");
  const first = useRef<string | undefined>(undefined);
  // the small picture shown first has another size than the page: a click on it is not sent
  const [small, setSmall] = useState(() => !still && !kept.has(src) && !!poster && kept.has(poster));
  const [url, setUrl] = useState<string | undefined>(() => {
    if (still) return src;
    const blob = kept.get(src) ?? (poster ? kept.get(poster) : undefined);
    return (first.current = blob && URL.createObjectURL(blob));
  });
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const shown = useRef(!!url);
  // the first picture fades in over its placeholder
  useLayoutEffect(() => {
    if (!url || shown.current) return;
    shown.current = true;
    const img = box.current?.querySelector("img");
    if (img) play("part-change", img, [{ opacity: 0 }, { opacity: 1 }]);
  }, [url]);
  useEffect(() => {
    if (still) {
      setUrl(src);
      return;
    }
    // a picture is read only while it is on screen, so a long list of browsers asks for few at once
    let seen = false;
    const watch = new IntersectionObserver((e) => (seen = e.some((x) => x.isIntersecting)));
    if (box.current) watch.observe(box.current);
    let done = false;
    let last: string | undefined = first.current;
    first.current = undefined;
    let ticks = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // an old picture is let go a moment later, so a card that just left can still show it
    const release = (u: string | undefined) => u && setTimeout(() => URL.revokeObjectURL(u), 1000);
    const tick = async () => {
      if (!document.hidden && seen) {
        try {
          const next = await loadPicture(src);
          if (done) URL.revokeObjectURL(next);
          else {
            setUrl(next);
            setSmall(false);
            setFailed(false);
            release(last);
            last = next;
          }
        } catch {
          if (!done) setFailed(true);
        }
      }
      // until it is first seen, it looks again soon
      if (!done) timer = setTimeout(tick, nextLook(seen || !!last, !!poster && ticks++ < 4, every));
    };
    void tick();
    return () => {
      done = true;
      watch.disconnect();
      clearTimeout(timer);
      release(last);
    };
  }, [src, every, still]);
  const point = (e: MouseEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const r = img.getBoundingClientRect();
    if (!onPoint || small || !r.width || !r.height) return;
    onPoint(((e.clientX - r.left) / r.width) * img.naturalWidth, ((e.clientY - r.top) / r.height) * img.naturalHeight);
  };
  const whole = fit === "whole";
  return (
    <div
      ref={box}
      className={`relative overflow-hidden bg-base ${whole ? "rounded" : "aspect-[16/10]"}`}
      data-picture={url ? "shown" : failed ? "failed" : "loading"}
    >
      {url ? (
        <img
          src={url}
          alt={alt}
          draggable={false}
          onClick={onPoint ? point : undefined}
          className={whole ? `block h-auto w-full select-none ${onPoint ? "cursor-crosshair" : ""}` : "absolute inset-0 size-full object-cover object-top"}
        />
      ) : (
        <div className={whole ? "relative aspect-[16/10]" : "absolute inset-0"}>
          <PicturePlaceholder host={host} failed={failed} />
        </div>
      )}
    </div>
  );
}

/**
 * One open browser as a card: its live picture, its task's plain title, where it is, the page's host and what it
 * waits for. One click opens it.
 */
export function BrowserCard({ b, picture, href, every = 5000 }: { b: Browser; picture: string; href: string; every?: number }) {
  const where = whereOf(b);
  const host = b.page && hostOf(b.page.url);
  return (
    <a
      href={href}
      className={`group block overflow-hidden rounded-lg border bg-raised ${b.waits ? "border-caution/40" : "border-transparent hover:border-line"}`}
      data-browser={b.session}
    >
      <div className="relative">
        <LivePicture src={picture} every={every} alt={`What ${b.title} shows now`} host={host} />
        {(b.waits || b.taken) && (
          <span className={`absolute left-2 top-2 rounded-sm px-2 py-0.5 text-xs font-semibold text-base ${b.waits ? "bg-caution" : "bg-fg"}`}>
            {b.waits ? "Waits for you" : "You have it"}
          </span>
        )}
      </div>
      <div className="min-w-0 p-3">
        <div className="flex min-w-0 items-center gap-2">
          <Shape state={b.waits ? "need" : "work"} size={12} />
          <h3 className="min-w-0 truncate font-medium text-fg" title={b.title}>
            {b.title}
          </h3>
        </div>
        {where && (
          <p className="mt-0.5 truncate text-xs text-fg3" title={where} data-where>
            {where}
          </p>
        )}
        {/* the row stays when the page is not read yet, so the card does not grow when its host comes */}
        <p className="mt-2 flex min-h-5 min-w-0 items-center gap-1.5 text-sm text-fg2" title={b.page?.url} data-host={host ? "" : undefined}>
          {host && (
            <>
              <Globe size={14} />
              <span className="truncate">{host}</span>
            </>
          )}
        </p>
        {b.waits && (
          <p className="mt-1 truncate text-sm text-caution" title={b.waits.question}>
            {b.waits.question}
          </p>
        )}
      </div>
    </a>
  );
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Fetches a fresh picture, keeps it, and returns its object URL once the browser can draw it. */
async function loadPicture(src: string): Promise<string> {
  const r = await fetch(`${src}${src.includes("?") ? "&" : "?"}t=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  const blob = await r.blob();
  keep(src, blob);
  const next = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = next;
    await img.decode();
  } catch (e) {
    URL.revokeObjectURL(next);
    throw e;
  }
  return next;
}

/** Milliseconds to the next look: soon until the first picture is seen, and quick for the first few when a poster stands in. */
const nextLook = (seen: boolean, early: boolean, every: number) => (!seen ? 100 : early ? Math.min(every, 300) : every);

const boxesOf = (ul: HTMLElement) => {
  const now = new Map<string, Box>();
  for (const el of ul.querySelectorAll<HTMLElement>(":scope > [data-key]")) {
    now.set(el.dataset.key ?? "", { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
  }
  return now;
};

/** Moves each card from its old place to its new one; a card that is new grows in. */
function slide(ul: HTMLElement, was: Map<string, Box>, motion: "browser-close" | "browser-open") {
  const box = ul.getBoundingClientRect();
  for (const el of ul.querySelectorAll<HTMLElement>(":scope > [data-key]")) {
    const from = was.get(el.dataset.key ?? "");
    if (!from) {
      stop(el);
      play("browser-open", el, [
        { transform: "scale(0.94)", opacity: 0 },
        { transform: "none", opacity: 1 },
      ]);
      continue;
    }
    // from where it is on screen now, so a change during a motion acts at once
    const r = el.getBoundingClientRect();
    const dx = from.x + (r.left - box.left - el.offsetLeft) - el.offsetLeft;
    const dy = from.y + (r.top - box.top - el.offsetTop) - el.offsetTop;
    if (Math.abs(dx) + Math.abs(dy) < 0.5) continue;
    stop(el);
    play(motion, el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }]);
  }
}

/** A closed card stays as a ghost where it was while it shrinks away. */
function leave(ul: HTMLElement, old: HTMLElement, key: string, at: Box) {
  const ghost = old.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("data-key");
  ghost.setAttribute("aria-hidden", "true");
  ghost.dataset.leaving = key;
  ghost.querySelectorAll("a, button").forEach((e) => e.setAttribute("tabindex", "-1"));
  Object.assign(ghost.style, {
    position: "absolute",
    left: `${at.x}px`,
    top: `${at.y}px`,
    width: `${at.w}px`,
    height: `${at.h}px`,
    pointerEvents: "none",
    margin: "0",
  });
  ul.append(ghost);
  const a = play("browser-close", ghost, [
    { transform: "none", opacity: 1 },
    { transform: "scale(0.94)", opacity: 0 },
  ]);
  const remove = () => ghost.remove();
  a ? a.finished.then(remove, remove) : remove();
}

/**
 * The open browsers as a grid of cards. A browser that opens grows in at its place, one that closes shrinks away
 * where it was, and the cards around them slide to their new places. Nothing waits for a motion to end.
 */
export function BrowserGrid({ items, card, lone = true }: { items: Browser[]; card: (b: Browser) => ReactNode; lone?: boolean }) {
  const list = useRef<HTMLUListElement>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const before = useRef<Map<string, Box> | null>(null);
  useLayoutEffect(() => {
    const ul = list.current;
    if (!ul) return;
    const now = boxesOf(ul);
    const was = before.current;
    before.current = now;
    if (!was) return;
    const gone = [...was.keys()].filter((k) => !now.has(k));
    const added = [...now.keys()].filter((k) => !was.has(k));
    if (!gone.length && !added.length) return;
    slide(ul, was, gone.length ? "browser-close" : "browser-open");
    for (const key of gone) {
      const old = els.current.get(key);
      els.current.delete(key);
      const at = was.get(key);
      if (old && at) leave(ul, old, key, at);
    }
  });
  // a resize moves things without a change: take the new places as they are
  useLayoutEffect(() => {
    const ul = list.current;
    if (!ul || typeof ResizeObserver === "undefined") return;
    const o = new ResizeObserver(() => {
      before.current = boxesOf(ul);
    });
    o.observe(ul);
    return () => o.disconnect();
  }, []);
  return (
    <ul
      ref={list}
      className={`relative grid grid-cols-2 gap-3 ${items.length === 1 && lone ? "sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" : "sm:grid-cols-2 lg:grid-cols-3"}`}
      data-browsers
    >
      {items.map((b) => (
        <li
          key={b.session}
          data-key={b.session}
          className="min-w-0"
          ref={(el) => {
            if (el) els.current.set(b.session, el);
          }}
        >
          {card(b)}
        </li>
      ))}
      {items.length === 1 && lone && (
        // one browser fills its row: the space beside it says where the next one shows
        <li
          className="hidden min-w-0 flex-col items-center justify-center rounded-lg border border-dashed border-line p-6 text-center sm:flex"
          data-browsers-more
        >
          <EmptyTrack />
          <p className="mt-3 text-sm text-fg2">The next browser an agent opens shows here.</p>
        </li>
      )}
    </ul>
  );
}
