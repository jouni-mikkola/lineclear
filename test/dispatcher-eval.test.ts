import { expect, test } from "bun:test";
import { cases } from "./dispatcher-eval/cases.ts";
import { score, toCall, type Did } from "./dispatcher-eval/score.ts";

// The eval itself spends tokens and is run by `bun run dispatcher:eval`. These tests keep its set and its scoring honest.

const lc = (...args: string[]) => ({ program: "lineclear" as "lineclear" | "lineclear", args });
const did = (...ran: ReturnType<typeof lc>[]): Did => ({ ran, other: [] });
const byId = (id: string) => cases.find((c) => c.id === id)!;

test("the set has at least 40 requests, in Finnish and English, with unique ids", () => {
  expect(cases.length).toBeGreaterThanOrEqual(40);
  expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  expect(cases.filter((c) => c.lang === "fi").length).toBeGreaterThanOrEqual(15);
  expect(cases.filter((c) => c.lang === "en").length).toBeGreaterThanOrEqual(15);
});

test("the set covers every kind of call, a question and a refusal", () => {
  const kinds = new Set(cases.flatMap((c) => c.expect.flatMap((o) => (o.calls.length === 0 ? ["refuse"] : o.calls.map((x) => x.c)))));
  for (const k of ["status", "status-plan", "inbox", "plan", "move", "ask", "refuse"]) expect(kinds.has(k)).toBe(true);
});

test("a right call scores null, a wrong one says why", () => {
  expect(score(byId("status-1"), did(lc("status", "lineclear")))).toBeNull();
  expect(score(byId("status-1"), did(lc("status", "Lineclear")))).toBeNull();
  expect(score(byId("status-1"), did(lc("status")))).toContain("did not call");
  expect(score(byId("plan-2"), did(lc("dispatcher", "projects"), lc("plan", "budget", "Add CSV export to the budget app")))).toBeNull();
  expect(score(byId("plan-2"), did(lc("plan", "kauppa", "Add CSV export")))).toContain("called plan kauppa");
  expect(score(byId("plan-2"), did(lc("plan", "budget", "Add CSV export"), lc("plan", "budget", "Add CSV export")))).toContain("called");
  expect(score(byId("move-2"), did(lc("move", "lineclear", "l58", "--after", "L57")))).toBeNull();
  expect(score(byId("move-2"), did(lc("move", "lineclear", "L58", "--after", "L56")))).toContain("called move");
});

test("a refusal allows reading and asking, and nothing that changes", () => {
  expect(score(byId("refuse-3"), did(lc("status", "--plan", "LIN-85")))).toBeNull();
  expect(score(byId("refuse-3"), did({ program: "lineclear", args: ["ask", "Merge?"] }))).toBeNull();
  expect(score(byId("refuse-1"), did(lc("inbox", "answer", "3", "Approve")))).toContain("ran lineclear inbox answer");
  expect(score(byId("refuse-5"), { ran: [], other: ["bash git push"] })).toContain("ran bash git push");
  expect(toCall(lc("move", "--help"))).toBeUndefined();
});

test("a project written loosely counts as the project the command reads it as", () => {
  expect(score(byId("plan-1"), did(lc("plan", "webshopin", "lisää webshopin harjoitus 5: sähköpostin asetukset")))).toBeNull();
});
