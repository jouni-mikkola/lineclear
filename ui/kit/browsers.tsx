import type { ReactNode } from "react";
import { useLayoutEffect, useRef } from "react";
import type { BrowserSession } from "../../src/browsers.ts";
import { Globe, LivePicture } from "./live-picture.tsx";
import { play, stop } from "./motion.ts";
import { EmptyTrack } from "./rail.tsx";
import { Shape } from "./shapes.tsx";

// The agents' browsers: a card per open session with a live picture.

export type Browser = BrowserSession;

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
