import { type MouseEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BrowserSession } from "../../src/browsers.ts";
import { play } from "./motion.ts";
import { Shape } from "./shapes.tsx";

// The agents' browsers: a card per open session with a live picture, and the picture itself.

export type Browser = BrowserSession;

/** A page's host, or the address as it is when it has none. */
export const hostOf = (url: string) => (URL.canParse(url) && new URL(url).host) || url;

/** Where a session is: its task, its project and what its name adds, or nothing when no task has it. */
export const whereOf = (b: Browser) => [b.task, b.project, b.note].filter(Boolean).join(" · ");

export const splitSessions = (all: Browser[]) => ({ tasks: all.filter((b) => b.task || b.waits), other: all.filter((b) => !b.task && !b.waits) });

/** A page drawn in outline, with its host, until the first picture of it comes. */
function PicturePlaceholder({ host, failed }: { host?: string; failed: boolean }) {
  return (
    <div className="absolute inset-0 flex flex-col bg-raised" aria-label={failed ? "No picture yet" : "The picture is loading"} data-placeholder>
      <div className="h-[12%] border-b border-line" />
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

/**
 * A live picture of a browser: the server's JPEG, read again every `every` ms while the page shows. The next
 * picture is decoded before it replaces the last, so it never flickers. A `data:` source is a still picture.
 * `fit="whole"` shows all of it, and `onPoint` then hears where it was clicked, in the browser's own pixels.
 */
export function LivePicture({
  src,
  every,
  alt,
  fit = "cover",
  host,
  onPoint,
}: {
  src: string;
  every: number;
  alt: string;
  fit?: "cover" | "whole";
  /** The page's host, shown on the placeholder until the first picture comes. */
  host?: string;
  onPoint?: (x: number, y: number) => void;
}) {
  const still = src.startsWith("data:");
  const [url, setUrl] = useState<string | undefined>(still ? src : undefined);
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
    let last: string | undefined;
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
            setFailed(false);
            release(last);
            last = next;
          }
        } catch {
          if (!done) setFailed(true);
        }
      }
      // until it is first seen, it looks again soon
      if (!done) timer = setTimeout(tick, seen || last ? every : 100);
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
    if (!onPoint || !r.width || !r.height) return;
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

/** One open browser as a card: its live picture, its task's plain title, where it is, the page's host and what it waits for. One click opens it. */
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
          {host && <Globe size={14} />}
          <span className="truncate">{host}</span>
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

/** Fetches a fresh picture and returns its object URL once the browser can draw it. */
async function loadPicture(src: string): Promise<string> {
  const r = await fetch(`${src}${src.includes("?") ? "&" : "?"}t=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  const blob = await r.blob();
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

/** A card that opens grows in at its place. */
function GrowIn({ children }: { children: ReactNode }) {
  const li = useRef<HTMLLIElement>(null);
  useLayoutEffect(() => {
    if (li.current)
      play("browser-open", li.current, [
        { transform: "scale(0.94)", opacity: 0 },
        { transform: "none", opacity: 1 },
      ]);
  }, []);
  return (
    <li ref={li} className="min-w-0">
      {children}
    </li>
  );
}

/** The open browsers as a grid of cards. A browser that opens grows in at its place. */
export function BrowserGrid({ items, card }: { items: Browser[]; card: (b: Browser) => ReactNode }) {
  return (
    <ul className="relative grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-browsers>
      {items.map((b) => (
        <GrowIn key={b.session}>{card(b)}</GrowIn>
      ))}
    </ul>
  );
}
