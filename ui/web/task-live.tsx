import { useEffect, useState } from "react";
import type { TaskArtifact, TerminalView } from "../../src/task-live.ts";
import { ArtifactCard, type ArtifactCardData, ArtifactFull } from "../kit/artifact-card.tsx";
import { Part, type PartState } from "../kit/index.ts";
import { TerminalInput, TerminalScreen } from "../kit/terminal.tsx";
import { get, post, sampleState } from "./data.ts";
import type { PageState } from "./samples.ts";

// A task's terminal and artifacts, the two tabs next to its chat. The terminal comes from the server's
// `/api/task/<id>/terminal/events` as the screen changes. `?state=` draws sample states instead.

const SHOWN = 60;
const LONG_TITLE = "The quarterly numbers for every shop, split by region, channel and the week the order was placed, with notes";

const SCREEN = [
  "\x1b[1m\x1b[32m$\x1b[0m bun test test/cart.test.ts",
  "\x1b[2mbun test v1.2\x1b[0m",
  "",
  "test/cart.test.ts:",
  "\x1b[32m✓\x1b[0m adds a line to the cart",
  "\x1b[32m✓\x1b[0m removes a line from the cart",
  "\x1b[31m✗\x1b[0m keeps the total when a line is removed",
  "",
  " 2 pass",
  " 1 fail",
  "\x1b[33mThe agent is fixing the total.\x1b[0m",
].join("\n");

const sampleTerminal = (s: PageState): TerminalView => {
  if (s === "loading") return { state: "loading", ansi: "" };
  if (s === "error") return { state: "offline", ansi: "", reason: "The terminal could not be read." };
  if (s === "offline") return { state: "offline", ansi: "", reason: "The board server is not running on this machine, so the terminal cannot be reached." };
  if (s === "empty") return { state: "ready", ansi: "" };
  const lines = s === "long" || s === "many" ? Array.from({ length: 200 }, (_, i) => `line ${i + 1}: ${"output ".repeat((i % 14) + 1)}`).join("\n") : SCREEN;
  return { state: "ready", ansi: lines };
};

const sampleArtifacts = (s: PageState): TaskArtifact[] | { error: string } | undefined => {
  if (s === "loading") return undefined;
  if (s === "error" || s === "offline") return { error: "The board server is not running on this machine, so the terminal cannot be reached." };
  if (s === "empty") return [];
  const one = (i: number, title: string, checked = true): TaskArtifact => ({
    id: `a${i}`,
    title,
    v: 2,
    when: `${i * 3}m`,
    by: "WEB-3 agent",
    checked,
    versions: [
      { n: 2, when: `${i * 3}m`, by: "WEB-3 agent", note: "Totals now follow the removed line" },
      { n: 1, when: `${i * 3 + 20}m`, by: "WEB-3 agent" },
    ],
  });
  if (s === "long") return [one(1, LONG_TITLE), one(2, "Cart flow", false)];
  if (s === "many") return Array.from({ length: 30 }, (_, i) => one(i + 1, `Report ${i + 1}`, i % 4 !== 0));
  return [one(1, "Cart totals report"), one(2, "Checkout flow", false), one(3, "Order list")];
};

/** An SVG picture for a sample card, so the shots are the same on every machine. */
const samplePicture = (id: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="black"/><rect x="24" y="24" width="140" height="12" rx="4" fill="white" fill-opacity=".25"/>${[0, 1, 2, 3, 4].map((i) => `<rect x="24" y="${60 + i * 24}" width="${200 + ((id.length + i * 37) % 80)}" height="10" rx="4" fill="white" fill-opacity=".12"/>`).join("")}</svg>`)}`;

const cards = (id: string, list: TaskArtifact[], sample: boolean): ArtifactCardData[] =>
  list.flatMap((a) =>
    a.versions.map((v) => ({
      id: a.id,
      title: a.title,
      n: v.n,
      when: v.when,
      by: v.by,
      note: v.note,
      checked: a.checked && v.n === a.v,
      thumb: sample ? samplePicture(a.id) : `/api/task/${encodeURIComponent(id)}/artifacts/${a.id}/thumb?v=${v.n}`,
      frame: sample ? "about:blank" : `/api/task/${encodeURIComponent(id)}/artifacts/${a.id}/frame?v=${v.n}&full=1`,
    })),
  );

function useTerminal(id: string, on: boolean) {
  const sample = sampleState();
  const [view, setView] = useState<TerminalView>(() => (sample ? sampleTerminal(sample) : { state: "loading", ansi: "" }));
  useEffect(() => {
    if (sample || !on) return;
    const es = new EventSource(`/api/task/${encodeURIComponent(id)}/terminal/events`);
    es.onmessage = (e) => {
      try {
        setView(JSON.parse(e.data) as TerminalView);
      } catch {
        // a broken event: the next one has the whole screen again
      }
    };
    es.onerror = () => setView((v) => (v.state === "ready" ? v : { state: "offline", ansi: "", reason: "The server did not answer: it is not running." }));
    return () => es.close();
  }, [id, on, sample]);
  return view;
}

const PART: Record<TerminalView["state"], PartState> = { loading: "loading", ready: "filled", offline: "error", none: "empty" };

export function TerminalTab({ id }: { id: string }) {
  const sample = sampleState();
  const view = useTerminal(id, true);
  const base = `/api/task/${encodeURIComponent(id)}/terminal/input`;
  const act = async (body: unknown) => (sample ? undefined : (await post(base, body)).ok ? undefined : "The terminal did not take it. Try again.");
  const ready = view.state === "ready";
  return (
    <div data-terminal={view.state}>
      <Part
        state={view.state === "ready" && !view.ansi ? "empty" : PART[view.state]}
        label="The terminal"
        empty={{ text: view.state === "none" ? (view.reason ?? "This task has no terminal.") : "The terminal shows nothing yet." }}
        error={view.reason}
        rows={6}
      >
        <TerminalScreen ansi={view.ansi} label={`The terminal of ${id}`} />
      </Part>
      <TerminalInput disabled={!ready} onSend={(text) => act({ text, enter: true })} onKey={(key) => act({ keys: [key] })} />
    </div>
  );
}

export function ArtifactsTab({ id }: { id: string }) {
  const sample = sampleState();
  const [list, setList] = useState<TaskArtifact[] | { error: string } | undefined>(() => (sample ? sampleArtifacts(sample) : undefined));
  const [open, setOpen] = useState<ArtifactCardData>();
  const [more, setMore] = useState(false);
  useEffect(() => {
    if (sample) return;
    let live = true;
    const read = () =>
      get<TaskArtifact[]>(`/api/task/${encodeURIComponent(id)}/artifacts`, Array.isArray).then(
        (d) => live && setList(d),
        (e) => live && setList({ error: String(e?.message ?? e) }),
      );
    void read();
    const t = setInterval(read, 5000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [id, sample]);
  const all = list && !("error" in list) ? cards(id, list, !!sample) : [];
  const state: PartState = !list ? "loading" : "error" in list ? "error" : all.length ? "filled" : "empty";
  const shown = more ? all : all.slice(0, SHOWN);
  return (
    <div data-artifacts={state}>
      <Part
        state={state}
        label="The artifacts"
        empty={{ text: "This task has made no artifacts." }}
        error={list && "error" in list ? list.error : undefined}
        rows={3}
      >
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((a) => (
            <li key={`${a.id}-${a.n}`} className="min-w-0">
              <ArtifactCard a={a} onOpen={() => setOpen(a)} />
            </li>
          ))}
        </ul>
        {all.length > shown.length && (
          <button type="button" onClick={() => setMore(true)} className="mt-3 text-sm text-fg3 hover:text-fg">
            {all.length - shown.length} more
          </button>
        )}
      </Part>
      <ArtifactFull a={open} onClose={() => setOpen(undefined)} />
    </div>
  );
}
