import { Dialog } from "@base-ui/react/dialog";
import { useCallback } from "react";
import type { SearchHit } from "../../src/search.ts";
import { play } from "./motion.ts";

// The search box: opened with `/` from any page, it finds tasks, their last chat cards and roadmap steps, and a
// result opens its page. Arrow keys move between results, Enter opens one.

export type SearchState = "idle" | "loading" | "error" | "ready";

const KIND: Record<SearchHit["kind"], string> = { task: "Task", chat: "Chat", step: "Step" };

export function SearchBox({
  open,
  onClose,
  query,
  onQuery,
  state,
  hits,
  error,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  query: string;
  onQuery: (q: string) => void;
  state: SearchState;
  hits: SearchHit[];
  error?: string;
  onPick: (hit: SearchHit) => void;
}) {
  const move = (e: React.KeyboardEvent<HTMLElement>, dir: 1 | -1) => {
    const all = [...(e.currentTarget.closest("[data-search]")?.querySelectorAll<HTMLElement>("input, [data-hit]") ?? [])];
    const at = all.indexOf(document.activeElement as HTMLElement);
    all[Math.min(all.length - 1, Math.max(0, at + dir))]?.focus();
    e.preventDefault();
  };
  // the popup mounts after the portal, so a ref callback, not an effect of this part, sees it arrive
  const fade = useCallback((el: HTMLDivElement | null) => {
    if (el) play("part-change", el, [{ opacity: 0 }, { opacity: 1 }]);
  }, []);
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-base/70" />
        <Dialog.Popup
          ref={fade}
          className="fixed inset-x-2 top-2 z-50 mx-auto flex max-h-[calc(100dvh-1rem)] max-w-xl flex-col rounded-lg border border-line bg-raised outline-none sm:top-[12vh]"
          data-search={state}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") move(e, 1);
            else if (e.key === "ArrowUp") move(e, -1);
          }}
        >
          <Dialog.Title className="sr-only">Search</Dialog.Title>
          <input
            autoFocus
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Tasks, chats, steps"
            aria-label="Search tasks, chats and steps"
            className="min-h-12 w-full rounded-t-lg border-b border-line bg-transparent px-4 text-fg placeholder:text-fg3 focus-visible:outline-2 focus-visible:outline-accent"
          />
          <div className="min-h-0 overflow-y-auto p-2">
            {state === "idle" ? null : state === "loading" ? (
              <p className="px-2 py-3 text-sm text-fg3" role="status">
                Searching
              </p>
            ) : state === "error" ? (
              <p className="px-2 py-3 text-sm text-fg2" role="alert">
                {error ?? "The search did not answer."}
              </p>
            ) : hits.length === 0 ? (
              <p className="px-2 py-3 text-sm text-fg3">Nothing found for this.</p>
            ) : (
              <ul>
                {hits.map((h) => (
                  <li key={`${h.kind}-${h.project ?? ""}-${h.id}`}>
                    <button
                      type="button"
                      data-hit={h.kind}
                      onClick={() => onPick(h)}
                      className="flex min-h-11 w-full flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left hover:bg-raised3 focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      <span className="flex w-full items-center gap-2 text-sm">
                        <span className="w-10 shrink-0 text-xs text-fg3">{KIND[h.kind]}</span>
                        <span className="min-w-0 break-words text-fg">{h.title}</span>
                      </span>
                      {h.text && <span className="line-clamp-2 break-words pl-12 text-xs text-fg3">{h.text}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
