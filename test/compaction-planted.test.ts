// A planted long session compacts. What the agent reads after it (the summary and the kept tail) must still answer
// its done-when, the owner's latest tell and its next step, and a tell planted long before the compaction is not lost.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import compactionNotes, { HEADINGS, stateFile } from "../pi/parts/compaction-notes.ts";
import { tmp } from "./helpers.ts";

const BRIEF = "Add the compaction gauge to Home.\nDone when: Home shows compactions per merged step and bun run check passes.";
const PLANTED = "Planted tell: the gauge counts the last 14 days, never all time.";
const LATEST = "Latest tell: call the card Compaction.";
const NEXT = "Draw the third tile, then run bun run check.";

type Entry = { type: "message"; id: string; message: { role: string; content: string | { type: string; text: string }[] } };
type Handler = (event: unknown, ctx: unknown) => { compaction?: { summary?: string } } | undefined;

function plantedSession(chat: string) {
  const root = tmp("planted");
  mkdirSync(join(root, ".pi", "agent"), { recursive: true });
  writeFileSync(join(root, ".pi", "agent", "settings.json"), "{}");
  const env = { HOME: root, TMPDIR: root, LINECLEAR_STATE: join(root, "state"), LINECLEAR_HOME: join(root, "store"), LINECLEAR_CHAT: chat };
  const h: Record<string, Handler> = {};
  const given: string[] = [];
  compactionNotes(
    {
      on: (e, f) => {
        h[e] = f as Handler;
      },
      sendUserMessage: () => undefined,
      sendMessage: (m) => void given.push(m.content),
    },
    env,
  );
  const entries: Entry[] = [];
  const user = (text: string) => {
    entries.push({ type: "message", id: `e${entries.length}`, message: { role: "user", content: text } });
    h.input?.({ text, source: "interactive" }, {});
  };
  const work = (n: number) => {
    for (let i = 0; i < n; i++) {
      entries.push({ type: "message", id: `e${entries.length}`, message: { role: "assistant", content: [{ type: "text", text: `step ${i}` }] } });
      entries.push({ type: "message", id: `e${entries.length}`, message: { role: "toolResult", content: [{ type: "text", text: "x".repeat(4_000) }] } });
    }
  };
  // tokens grow with the session, about one per four characters, in a 200 k window
  const tokens = () => Math.round(JSON.stringify(entries).length / 4);
  const turn = () =>
    h.turn_end?.({ toolResults: [{}] }, { model: { provider: "p", id: "m" }, getContextUsage: () => ({ tokens: tokens(), contextWindow: 200_000 }) });
  return { env, h, given, entries, user, work, turn, tokens };
}

/** What the agent reads after the compaction: the summary, what pi gives back after it, and the kept tail. */
function afterCompaction(s: ReturnType<typeof plantedSession>, keepFrom: number): string {
  const result = s.h.session_before_compact?.(
    {
      reason: "threshold",
      branchEntries: s.entries,
      preparation: { firstKeptEntryId: s.entries[keepFrom]?.id, tokensBefore: s.tokens(), fileOps: { written: new Set(["ui/web/usage.tsx"]) } },
    },
    {},
  );
  s.h.session_compact?.({ reason: "threshold" }, {});
  const kept = s.entries.slice(keepFrom).map((e) => (typeof e.message.content === "string" ? e.message.content : (e.message.content[0]?.text ?? "")));
  return [result?.compaction?.summary ?? "(pi's own summary)", ...s.given, ...kept].join("\n\n");
}

test("a task's agent still knows its done-when, the latest tell and its next step after a compaction, and the planted tell", () => {
  const s = plantedSession("LIN-9/Agent");
  s.user(BRIEF);
  s.work(5);
  s.user(PLANTED);
  for (let i = 0; i < 200 && s.tokens() < 170_000; i++) {
    s.work(10);
    s.turn();
  }
  s.user(LATEST);
  // the agent answers the ask with its notes
  const notes = { Done: "The data for the gauge.", "In progress": "The card.", Next: NEXT, Decisions: "Last 14 days, as told.", Open: "none" };
  mkdirSync(join(stateFile(s.env), ".."), { recursive: true });
  writeFileSync(stateFile(s.env), HEADINGS.map((x) => `## ${x}\n${notes[x as keyof typeof notes]}`).join("\n\n"));
  s.work(2);
  const keepFrom = s.entries.length - 4;
  const read = afterCompaction(s, keepFrom);
  expect(s.entries.slice(keepFrom).some((e) => JSON.stringify(e).includes("Planted"))).toBe(false);
  expect(read).toContain("Done when: Home shows compactions per merged step and bun run check passes.");
  expect(read).toContain(LATEST);
  expect(read).toContain(`## Next\n${NEXT}`);
  expect(read).toContain(PLANTED);
  expect(read.length).toBeLessThan(10_000);
});

test("a coordinator still has the owner's planted direction after a compaction pi summarised itself", () => {
  const s = plantedSession("lineclear");
  s.user("You are the coordinator of the space lineclear.");
  s.user(PLANTED);
  for (let i = 0; i < 200 && s.tokens() < 170_000; i++) {
    s.work(10);
    s.user("<shepherdr><heartbeat>nothing new</heartbeat></shepherdr>");
    s.turn();
  }
  s.user(LATEST);
  const read = afterCompaction(s, s.entries.length - 2);
  expect(read).toContain("(pi's own summary)");
  expect(read).toContain(PLANTED);
  expect(read).toContain(LATEST);
});
