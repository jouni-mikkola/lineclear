import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import compactionNotes, {
  HEADINGS,
  MAX_FILE,
  MAX_MESSAGES,
  MARK,
  OVERRUN,
  REASK_AFTER,
  compactionPoint,
  logFile,
  notesStats,
  stateFile,
} from "../pi/parts/compaction-notes.ts";
import { directionLogFile } from "../pi/direction-log.ts";
import { tmp } from "./helpers.ts";

function setup(chat: string | null = "LIN-1/Agent") {
  const root = tmp("notes");
  mkdirSync(join(root, ".pi", "agent"), { recursive: true });
  writeFileSync(join(root, ".pi", "agent", "settings.json"), JSON.stringify({ compaction: { modelOverrides: { "p/m": { reserveTokens: 50_000 } } } }));
  // the role point is off here, so these tests read pi's own point
  mkdirSync(join(root, "config"));
  writeFileSync(join(root, "config", "pack.json"), JSON.stringify({ off: ["compaction-point"] }));
  const env = {
    HOME: root,
    TMPDIR: root,
    LINECLEAR_STATE: join(root, "state"),
    LINECLEAR_CONFIG: join(root, "config"),
    LINECLEAR_HOME: join(root, "store"),
    LINECLEAR_CHAT: chat ?? undefined,
  };
  const h: Record<string, (e: any, c: any) => any> = {};
  const sent: string[] = [];
  const given: string[] = [];
  compactionNotes({ on: (e, f) => void (h[e] = f), sendUserMessage: (t: string) => void sent.push(t), sendMessage: (m) => void given.push(m.content) }, env);
  const say = (text: string, source = "interactive") => h.input?.({ text, source }, {});
  const turn = (tokens: number | null, window = 200_000, ev: any = { toolResults: [{}] }) =>
    h.turn_end?.(ev, { model: { provider: "p", id: "m" }, getContextUsage: () => ({ tokens, contextWindow: window }) });
  const entries = [
    { type: "message", message: { role: "user", content: "Build step L1" } },
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } },
    { type: "message", message: { role: "user", content: [{ type: "text", text: 'use "tabs"\nnot spaces' }] } },
  ];
  const compact = (extra: any = {}) =>
    h.session_before_compact?.(
      {
        reason: "threshold",
        branchEntries: [...entries, { type: "message", message: { role: "user", content: `${MARK} write it` } }],
        preparation: {
          firstKeptEntryId: "k1",
          tokensBefore: 130_000,
          fileOps: { read: new Set(["r.ts"]), written: new Set(["a.ts"]), edited: new Set(["b.ts"]) },
        },
        ...extra,
      },
      {},
    );
  const good = HEADINGS.map((x) => `## ${x}\n${x} text`).join("\n\n");
  const write = (text: string, ageSeconds = 0) => {
    const f = stateFile(env);
    mkdirSync(join(f, ".."), { recursive: true });
    writeFileSync(f, text);
    const t = new Date(Date.now() - ageSeconds * 1000);
    utimesSync(f, t, t);
  };
  const logged = () => {
    try {
      return readFileSync(logFile(env), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  };
  return { env, h, sent, given, say, turn, compact, write, good, logged, entries };
}

test("near the compaction point the agent is asked once, with the headings", () => {
  const s = setup();
  s.turn(50_000);
  expect(s.sent).toEqual([]);
  s.turn(130_000);
  s.turn(140_000);
  s.turn(145_000);
  expect(s.sent.length).toBe(1);
  expect(s.sent[0]).toStartWith(MARK);
  for (const x of HEADINGS) expect(s.sent[0]).toContain(`## ${x}`);
  expect(s.sent[0]).toContain(stateFile(s.env));
});

test("the compaction point comes from pi's settings: a reserve of your own, or pi's default", () => {
  const s = setup();
  expect(compactionPoint(200_000, "p/m", s.env)).toBe(150_000);
  expect(compactionPoint(200_000, "p/other", s.env)).toBe(200_000 - 16_384);
  s.turn(80_000, 100_000); // pi's default reserve: compacts at 83.6 k, asked from 75.2 k
  expect(s.sent.length).toBe(1);
});

test("a role point below pi's own is the compaction point", () => {
  const s = setup();
  const on = { ...s.env, LINECLEAR_CONFIG: join(s.env.HOME, "none") };
  expect(compactionPoint(200_000, "p/m", on)).toBe(80_000);
  expect(compactionPoint(1_000_000, "p/m", on)).toBe(80_000);
});

test("a turn that made no tool calls does not ask, so a run that is ending is not woken", () => {
  const s = setup();
  s.turn(140_000, 200_000, { toolResults: [] });
  expect(s.sent).toEqual([]);
  s.turn(140_000);
  expect(s.sent.length).toBe(1);
});

test("a reviewer is never asked; a coordinator, the Dispatcher and your own session are", () => {
  const r = setup("LIN-1/Reviewer");
  r.turn(140_000);
  expect(r.sent).toEqual([]);
  expect(r.compact()).toBeUndefined();
  for (const chat of ["lineclear", "dispatcher", null]) {
    const s = setup(chat);
    s.turn(140_000);
    expect(s.sent.length).toBe(1);
    s.write(s.good);
    expect(s.compact().compaction.summary).toContain("## First message\nBuild step L1");
  }
});

test("each session has its own state file: a task's, a chat's, or the process's when there is no chat", () => {
  expect(stateFile(setup("LIN-1/Agent").env)).toEndWith("/LIN-1/state.md");
  expect(stateFile(setup("lineclear").env)).toEndWith("/lineclear/state.md");
  expect(stateFile(setup(null).env)).toEndWith(`/session-${process.pid}/state.md`);
});

test("a good file becomes the summary with the task, the messages word for word and the files changed", () => {
  const s = setup();
  s.turn(140_000);
  s.write(s.good);
  const r = s.compact();
  const sum: string = r.compaction.summary;
  expect(sum).toContain("## Task\nBuild step L1");
  expect(sum).toContain('1. use "tabs"\nnot spaces');
  expect(sum).not.toContain("write it");
  expect(sum).toContain("- a.ts\n- b.ts");
  expect(sum).not.toContain("r.ts");
  for (const x of HEADINGS) expect(sum).toContain(`## ${x}\n${x} text`);
  expect(r.compaction.firstKeptEntryId).toBe("k1");
  expect(r.compaction.tokensBefore).toBe(130_000);
  expect(s.logged().map((e) => e.ev)).toEqual(["used"]);
});

test("files changed before an earlier compaction stay in the summary", () => {
  const s = setup();
  s.turn(140_000);
  s.write(s.good);
  const r = s.compact({ branchEntries: [{ type: "compaction", details: { changed: ["old.ts"] } }] });
  expect(r.compaction.summary).toContain("- a.ts\n- b.ts\n- old.ts");
});

test("a missing file falls back to pi's summary and the log says why", () => {
  const s = setup();
  s.turn(140_000);
  expect(s.compact()).toBeUndefined();
  expect(s.logged()).toMatchObject([{ ev: "fallback", reason: "no state file" }]);
});

test("a file older than the ask falls back", () => {
  const s = setup();
  s.write(s.good, 3600);
  s.turn(140_000);
  expect(s.compact()).toBeUndefined();
  expect(s.logged()[0].reason).toContain("older");
});

test("a file that was never asked for falls back", () => {
  const s = setup();
  s.write(s.good);
  expect(s.compact()).toBeUndefined();
  expect(s.logged()[0].reason).toContain("older");
});

test("a file a little over the length is used, not lost", () => {
  const s = setup();
  s.turn(140_000);
  s.write(`${s.good}\n${"x".repeat(MAX_FILE + OVERRUN - s.good.length - 1)}`);
  expect(s.compact().compaction.summary).toContain("## Done\nDone text");
});

test("a file that is too long falls back", () => {
  const s = setup();
  s.turn(140_000);
  s.write(`${s.good}\n${"x".repeat(MAX_FILE + OVERRUN)}`);
  expect(s.compact()).toBeUndefined();
  expect(s.logged()[0].reason).toContain("too long");
});

test("a file lacking a heading falls back and names it", () => {
  const s = setup();
  s.turn(140_000);
  s.write("## Done\nx\n## Next\ny");
  expect(s.compact()).toBeUndefined();
  expect(s.logged()[0].reason).toContain("In progress");
});

test("a compaction with instructions of its own falls back", () => {
  const s = setup();
  s.turn(140_000);
  s.write(s.good);
  expect(s.compact({ customInstructions: "focus on tests" })).toBeUndefined();
  expect(s.logged()[0].reason).toContain("instructions");
});

test("after a fallback the next cycle asks again, and the share of fallbacks is counted", () => {
  const s = setup();
  s.turn(140_000);
  s.compact();
  s.turn(140_000);
  expect(s.sent.length).toBe(2);
  s.write(s.good);
  s.compact();
  const lines = readFileSync(logFile(s.env), "utf8").split("\n").filter(Boolean);
  expect(notesStats(lines)).toEqual({ compactions: 2, used: 1, fellBack: 1, share: 0.5 });
});

test("every message of the owner is kept word for word, however many", () => {
  const s = setup();
  s.turn(140_000);
  s.write(s.good);
  const many = Array.from({ length: 10 }, (_, i) => ({ type: "message", message: { role: "user", content: `m${i} ${"y".repeat(5000)}` } }));
  const sum: string = s.compact({ branchEntries: [{ type: "message", message: { role: "user", content: "the task" } }, ...many] }).compaction.summary;
  expect(sum).toContain("## Task\nthe task");
  for (let i = 0; i < 10; i++) expect(sum).toContain(`m${i} ${"y".repeat(5000)}`);
});

test("a file lacking a heading falls back and names it", () => {
  const s = setup();
  s.turn(140_000);
  s.write("## Done\nx\n## Next\ny");
  expect(s.compact()).toBeUndefined();
  expect(s.logged()[0].reason).toContain("In progress");
});

test("a compaction with instructions of its own falls back", () => {
  const s = setup();
  s.turn(140_000);
  s.write(s.good);
  expect(s.compact({ customInstructions: "focus on tests" })).toBeUndefined();
  expect(s.logged()[0].reason).toContain("instructions");
});

test("after a fallback the next cycle asks again, and the share of fallbacks is counted", () => {
  const s = setup();
  s.turn(140_000);
  s.compact();
  s.turn(140_000);
  expect(s.sent.length).toBe(2);
  s.write(s.good);
  s.compact();
  const lines = readFileSync(logFile(s.env), "utf8").split("\n").filter(Boolean);
  expect(notesStats(lines)).toEqual({ compactions: 2, used: 1, fellBack: 1, share: 0.5 });
});

test("every message of the owner is kept word for word, however many", () => {
  const s = setup();
  s.turn(140_000);
  s.write(s.good);
  const many = Array.from({ length: 10 }, (_, i) => ({ type: "message", message: { role: "user", content: `m${i} ${"y".repeat(5000)}` } }));
  const sum: string = s.compact({ branchEntries: [{ type: "message", message: { role: "user", content: "the task" } }, ...many] }).compaction.summary;
  expect(sum).toContain("## Task\nthe task");
  for (let i = 0; i < 10; i++) expect(sum).toContain(`m${i} ${"y".repeat(5000)}`);
});

test("a file lacking a heading is asked for once more, with the reason, and a fixed file is used", () => {
  const s = setup();
  s.turn(140_000);
  s.write("## Done\nx\n## Next\ny");
  s.turn(141_000);
  s.turn(142_000);
  expect(s.sent.length).toBe(2);
  expect(s.sent[1]).toStartWith(MARK);
  expect(s.sent[1]).toContain("In progress");
  s.write(s.good);
  expect(s.compact().compaction.summary).toContain("## Next\nNext text");
});

test("no file a few turns after the ask is asked for once more, never twice", () => {
  const s = setup();
  s.turn(140_000);
  for (let i = 1; i < REASK_AFTER; i++) s.turn(140_000 + i);
  expect(s.sent.length).toBe(1);
  for (let i = 0; i < 5; i++) s.turn(145_000 + i);
  expect(s.sent.length).toBe(2);
  expect(s.sent[1]).toContain("no state file");
});

test("Lineclear's own tagged lines are not the owner's messages", () => {
  const s = setup();
  s.turn(140_000);
  s.write(s.good);
  const r = s.compact({
    branchEntries: [...s.entries, { type: "message", message: { role: "user", content: "<lineclear><heartbeat>nothing new</heartbeat></lineclear>" } }],
  });
  expect(r.compaction.summary).not.toContain("heartbeat");
});

test("a coordinator's summary keeps the newest owner's messages and says where the rest are", () => {
  const s = setup("lineclear");
  s.turn(140_000);
  s.write(s.good);
  const many = Array.from({ length: MAX_MESSAGES + 5 }, (_, i) => ({ type: "message", message: { role: "user", content: `tell ${i}` } }));
  const sum: string = s.compact({ branchEntries: [s.entries[0], ...many] }).compaction.summary;
  expect(sum).not.toContain("tell 4\n");
  expect(sum).toContain(`tell ${MAX_MESSAGES + 4}`);
  expect(sum).toContain(`5 earlier messages of the owner are in the owner's direction log, ${directionLogFile(s.env)}`);
});

test("a coordinator logs each owner statement word for word with its time; Lineclear's lines and the pack's own are not", () => {
  const s = setup("lineclear");
  s.say("Keep the line green\nalways");
  s.say('<reply from="Elias" to="Merge it?">Yes, merge it</reply>');
  s.say('<answer from="Elias" question="Rerun CI?">Rerun it</answer>');
  s.say("<lineclear><heartbeat>tick</heartbeat></lineclear>");
  s.say('<reaction from="Elias" emoji="👍" to="ok"/>');
  s.say('<attachment from="Elias" name="a.png" path="~/inbox/a.png"/>');
  s.say(`${MARK} write it`);
  s.say("from another part", "extension");
  s.say('<reply from="Elias" to="Look?">See the shot</reply>\n<attachment from="Elias" name="a.png" path="~/inbox/a.png"/>');
  s.say('<artifact-comment from="Elias" title="Weekly board" artifact="wk3n" version="2">Make the bars blue</artifact-comment>');
  s.say('<artifact-note from="Elias" title="Board" artifact="b" version="1" on="Send">Say Send event.</artifact-note>');
  s.say('<browser-notes from="Elias" url="http://localhost:5173/" title="S">\n1. button "Save"\n   Note: Say Save changes.\n</browser-notes>');
  s.say('<answer from="Elias" question="Rerun CI?">Rerun it</answer>\nand skip the flaky test');
  s.say('<reply from="Elias" to="use a -> b">Keep it</reply>');
  s.say("<div> in the card overflows");
  const long = "x".repeat(3_000);
  s.say(long);
  const log = readFileSync(directionLogFile(s.env), "utf8").trim().split("\n");
  expect(log.length).toBe(11);
  expect(log[0]).toMatch(/^- \d{4}-\d\d-\d\d \d\d:\d\d \(lineclear\): Keep the line green \/ always$/);
  expect(log[1]).toEndWith("(lineclear): Yes, merge it");
  expect(log[2]).toEndWith("(lineclear): Rerun CI? Rerun it");
  expect(log[3]).toEndWith("(lineclear): See the shot");
  expect(log[4]).toEndWith("(lineclear): On Weekly board: Make the bars blue");
  expect(log[5]).toEndWith("(lineclear): On Board, Send: Say Send event.");
  expect(log[6]).toEndWith('(lineclear): Browser notes on http://localhost:5173/: 1. button "Save" / Note: Say Save changes.');
  expect(log[7]).toEndWith("(lineclear): Rerun CI? Rerun it / and skip the flaky test");
  expect(log[8]).toEndWith("(lineclear): Keep it");
  expect(log[9]).toEndWith("(lineclear): <div> in the card overflows");
  expect(log[10]).toEndWith(`(lineclear): ${long}`); // kept whole in the log
  s.h.session_compact?.({ reason: "threshold" }, {});
  expect(s.given.at(-1)).toContain(`(cut: the whole line is in ${directionLogFile(s.env)})`);
  expect(s.given.at(-1)).not.toContain(long);
});

test("a task's agent and your own session log nothing to the direction log", () => {
  for (const chat of ["LIN-1/Agent", null]) {
    const s = setup(chat);
    s.say("use tabs");
    expect(() => readFileSync(directionLogFile(s.env))).toThrow();
  }
});

test("after any compaction, even pi's own, a coordinator and your own session get the direction log back; an agent does not", () => {
  const c = setup("lineclear");
  c.h.session_compact?.({ reason: "threshold" }, {});
  expect(c.given).toEqual([]); // an empty log gives nothing
  c.say("Planted: never merge red");
  c.turn(140_000);
  c.compact(); // no state file: pi's own summary
  c.h.session_compact?.({ reason: "threshold" }, {});
  expect(c.given.length).toBe(1);
  expect(c.given[0]).toContain("Planted: never merge red");
  const own = setup(null);
  own.env.LINECLEAR_HOME = c.env.LINECLEAR_HOME;
  own.h.session_compact?.({ reason: "threshold" }, {});
  expect(own.given[0]).toContain("Planted: never merge red");
  const a = setup("LIN-1/Agent");
  a.env.LINECLEAR_HOME = c.env.LINECLEAR_HOME;
  a.h.session_compact?.({ reason: "threshold" }, {});
  expect(a.given).toEqual([]);
});
