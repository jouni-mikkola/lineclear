import { useEffect, useState } from "react";
import type { TerminalView } from "../../src/task-live.ts";
import { Part, type PartState } from "../kit/index.ts";
import { TerminalInput, TerminalScreen } from "../kit/terminal.tsx";
import { post, sampleState } from "./data.ts";
import type { PageState } from "./samples.ts";

// A task's terminal, the tab next to its chat. It comes from the server's `/api/task/<id>/terminal/events` as the
// screen changes. `?state=` draws sample states instead.

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
