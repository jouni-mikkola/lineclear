import { useEffect, useState } from "react";
import type { SearchHit } from "../../src/search.ts";
import { SearchBox, type SearchState } from "../kit/search.tsx";
import { get, sampleState } from "./data.ts";
import { roadmapPath } from "./routes.ts";

// Search from any page: `/` opens it, a result opens its page. `?state=` draws sample answers instead of asking.

const SAMPLE_HITS: SearchHit[] = [
  { kind: "task", id: "WEB-3", title: "WEB-3 Pay with a saved card" },
  { kind: "chat", id: "WEB-3", title: "WEB-3 Pay with a saved card", text: "The agent is fixing the cart total after a line is removed." },
  { kind: "step", id: "W4", title: "W4 Cart totals", text: "The total follows each line you remove.", project: "web-shop" },
];

export function Search({ go, onClose }: { go: (path: string) => void; onClose: () => void }) {
  const sample = sampleState();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ hits: SearchHit[] } | { error: string } | undefined>();
  useEffect(() => {
    setFound(undefined);
    if (!query.trim()) return;
    if (sample) {
      setFound(sample === "error" || sample === "offline" ? { error: "The search did not answer." } : { hits: sample === "empty" ? [] : SAMPLE_HITS });
      return;
    }
    let live = true;
    const t = setTimeout(
      () =>
        get<SearchHit[]>(`/api/search?q=${encodeURIComponent(query)}`, Array.isArray).then(
          (hits) => live && setFound({ hits }),
          (e) => live && setFound({ error: String(e?.message ?? e) }),
        ),
      200,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, sample]);
  const state: SearchState = !query.trim() ? "idle" : !found ? "loading" : "error" in found ? "error" : "ready";
  return (
    <SearchBox
      open
      onClose={onClose}
      query={query}
      onQuery={setQuery}
      state={state}
      hits={found && "hits" in found ? found.hits : []}
      error={found && "error" in found ? found.error : undefined}
      onPick={(h) => {
        onClose();
        go(h.kind === "step" && h.project ? roadmapPath(h.project, h.id) : `/task/${encodeURIComponent(h.id)}`);
      }}
    />
  );
}
