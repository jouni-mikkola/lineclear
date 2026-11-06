import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import cutOutput, { CAP, cutStats, logFile, removeSecrets, saveDir } from "../pi/parts/cut-output.ts";
import { tmp } from "./helpers.ts";

function setup(extra: Record<string, string> = {}) {
  const root = tmp("cut");
  const env = { HOME: root, TMPDIR: root, LINECLEAR_STATE: join(root, "state"), LINECLEAR_CHAT: "LIN-1/Agent", ...extra };
  const h: Record<string, (e: any, c: any) => any> = {};
  cutOutput({ on: (e, f) => void (h[e] = f) }, env);
  const result = (toolName: string, text: string, input: any = {}, more: any[] = []) =>
    h.tool_result!({ toolName, input, content: [{ type: "text", text }, ...more] }, { cwd: root });
  return { root, env, h, result };
}
const big = (n = 3000) => Array.from({ length: n }, (_, i) => `line ${i} of a long result`).join("\n");

test("a long result keeps its start and its end, and the whole is saved", () => {
  const s = setup();
  const text = big();
  const r = s.result("bash", text, { command: "cat big" });
  const out = r.content[0].text;
  expect(out.length).toBeLessThan(CAP + 1000);
  expect(out.startsWith("line 0 of")).toBe(true);
  expect(out.endsWith("line 2999 of a long result")).toBe(true);
  const dir = saveDir(s.env);
  const files = readdirSync(dir) as string[];
  expect(files).toEqual(["0001-bash.txt"]);
  expect(readFileSync(join(dir, files[0]!), "utf8")).toBe(text);
  expect(out).toContain(join(dir, files[0]!));
  expect(out).toMatch(/read .* with offset=\d+ limit=200/);
});

test("a short result is left as it is", () => {
  expect(setup().result("bash", "short", { command: "ls" })).toBeUndefined();
});

test("secrets are removed from the file and from the cut result", () => {
  const s = setup({ MY_API_KEY: "hunter2hunter2" });
  const ghp = `ghp_${"a".repeat(36)}`;
  const text = `${ghp}\nuse hunter2hunter2\n${big()}\nTOKEN_X=abcdefghij\n${ghp}`;
  const out = s.result("bash", text, { command: "env" }).content[0].text;
  const saved = readFileSync(join(saveDir(s.env), "0001-bash.txt"), "utf8");
  for (const t of [out, saved]) {
    expect(t).not.toContain(ghp);
    expect(t).not.toContain("hunter2hunter2");
    expect(t).not.toContain("abcdefghij");
  }
  expect(removeSecrets("Bearer abcdefghijklmnopqrstuvwxyz0123")).toBe("Bearer [secret removed]");
});

test("test output keeps its failures and its summary", () => {
  const s = setup();
  const body = Array.from({ length: 1500 }, (_, i) => `(pass) test ${i} ok`);
  body.splice(300, 0, "(fail) the cut > keeps the end");
  body.splice(700, 0, "AssertionError: expected 1 to be 2");
  body.push(...Array.from({ length: 60 }, (_, i) => `tail ${i}`), " 1500 pass", " 2 fail");
  const text = body.join("\n");
  const out = s.result("bash", text, { command: "cd x && bun test" }).content[0].text;
  expect(out).toContain("the cut > keeps the end");
  expect(out).toContain("AssertionError: expected 1 to be 2");
  expect(out).toContain("2 fail");
  expect(out).toContain("tail 59");
  expect(out).not.toContain("test 1200 ok");
  expect(out.length).toBeLessThan(text.length / 3);
  expect(readFileSync(join(saveDir(s.env), "0001-bash.txt"), "utf8")).toBe(text);
});

test("test output under the test size is left alone", () => {
  expect(setup().result("bash", "(pass) a\n".repeat(100), { command: "bun test" })).toBeUndefined();
});

test("writes, edits, images and the chat are never cut", () => {
  const s = setup();
  expect(s.result("write", big(), { path: "a" })).toBeUndefined();
  expect(s.result("edit", big(), { path: "a" })).toBeUndefined();
  expect(s.result("read", big(), { path: "a" }, [{ type: "image", data: "x" }])).toBeUndefined();
  expect(s.result("bash", big(), { command: "lineclear chat say hello" })).toBeUndefined();
  expect(s.result("bash", big(), { command: "lineclear ask 'q' --choice a" })).toBeUndefined();
  expect(existsSync(saveDir(s.env))).toBe(false);
  expect(s.result("read", big(), { path: "a" })).toBeDefined(); // a read is cut
});

test("a result is not cut when it cannot be saved", () => {
  const s = setup({ TMPDIR: "/proc/nope" });
  expect(s.result("bash", big(), { command: "cat big" })).toBeUndefined();
});

test("reading the saved file back is not cut again", () => {
  const s = setup();
  s.result("bash", big(), { command: "cat big" });
  const file = join(saveDir(s.env), "0001-bash.txt");
  expect(s.result("read", big(), { path: file })).toBeUndefined();
});

test("the log counts the cuts, the saving and the cuts read again", () => {
  const s = setup();
  s.result("bash", big(), { command: "cat a" });
  s.result("bash", big(4000), { command: "cat b" });
  s.h.tool_call!({ toolName: "read", input: { path: join(saveDir(s.env), "0001-bash.txt") } }, { cwd: s.root });
  s.h.tool_call!({ toolName: "read", input: { path: join(saveDir(s.env), "0001-bash.txt") } }, { cwd: s.root });
  s.h.tool_call!({ toolName: "bash", input: { command: "cat b" } }, { cwd: s.root });
  s.h.tool_call!({ toolName: "bash", input: { command: "ls" } }, { cwd: s.root });
  const stats = cutStats(readFileSync(logFile(s.env), "utf8").split("\n").filter(Boolean));
  expect(stats.cuts).toBe(2);
  expect(stats.reread).toBe(2);
  expect(stats.share).toBe(1);
  expect(stats.rerun).toBe(1);
  expect(stats.saved).toBeGreaterThan(40_000);
});
