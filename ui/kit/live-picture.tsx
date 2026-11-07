import { type MouseEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { play } from "./motion.ts";

// A live picture of a browser, and the outline of a page it shows until the first picture comes.

export const Globe = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className="shrink-0 text-fg3">
    <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.3" fill="none" />
    <path d="M1.75 8h12.5M8 1.75c2 2.2 2 10.3 0 12.5M8 1.75c-2 2.2-2 10.3 0 12.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
  </svg>
);

function PicturePlaceholder({ host, failed }: { host?: string; failed: boolean }) {
  return (
    <div className="absolute inset-0 flex flex-col bg-raised" aria-label={failed ? "No picture yet" : "The picture is loading"} data-placeholder>
      <div className="flex h-[12%] items-center gap-1.5 border-b border-line px-3">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1.5 rounded-full bg-line" />
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
        <Globe />
        {host && <span className="max-w-full truncate text-sm text-fg2">{host}</span>}
        {failed && <span className="text-xs text-fg3">No picture yet.</span>}
      </div>
    </div>
  );
}

/** The last picture read per address, so a view that opens shows what the last one showed at once. */
const kept = new Map<string, Blob>();

/** Fetches a fresh picture, keeps it, and returns its object URL once the browser can draw it. */
async function loadPicture(src: string): Promise<string> {
  const r = await fetch(`${src}${src.includes("?") ? "&" : "?"}t=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  const blob = await r.blob();
  kept.delete(src);
  kept.set(src, blob);
  if (kept.size > 60) kept.delete(kept.keys().next().value!);
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
