import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli.ts";
import { brandedAnswer, brandedHelp, isBoardJob, piByDefault } from "../src/serve.ts";

test("serve takes only --port with a number", async () => {
  for (const args of [
    ["serve", "--port"],
    ["serve", "--port", "x"],
    ["serve", "--port", "99999"],
    ["serve", "now"],
  ]) {
    const out: string[] = [];
    expect(await main(args, (l) => out.push(l))).toBe(2);
    expect(out).toEqual(["usage: lineclear serve [--port <port>]"]);
  }
});

test("a new board runs pi for every role, and a board with settings keeps them", () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-serve-"));
  const file = join(dir, "settings.json");
  const read = () => JSON.parse(readFileSync(file, "utf8"));
  piByDefault({ LINECLEAR_HOME: dir });
  expect(read().everywhere).toEqual({ "task.agent": "pi", "coordinator.agent": "pi", "reviewer.agent": "pi" });

  writeFileSync(file, JSON.stringify({ everywhere: { "reviewer.agent": "Codex", alerts: "x" }, machine: { a: "1" }, spaces: {} }));
  piByDefault({ LINECLEAR_HOME: dir });
  expect(read()).toEqual({ everywhere: { "reviewer.agent": "Codex", alerts: "x" }, machine: { a: "1" }, spaces: {} });
  rmSync(dir, { recursive: true });
});

test("the board's help says Lineclear, renames its ask to card and leaves out the lines Lineclear answers itself", () => {
  const help = [
    "lineclear: talk to Lineclear from a terminal",
    "  lineclear space add <path>   add a repo",
    '  lineclear ask "<q>" --choice a',
    "                                 asks the human",
    '  lineclear status <id> "<line>" --done 5',
    "  lineclear doctor               check every machine",
    "                                 and put its helper there",
    "  lineclear status               spaces",
    "  lineclear task list",
  ].join("\n");
  expect(brandedHelp(help)).toBe(
    [
      "lineclear: talk to Lineclear from a terminal",
      "  lineclear space add <path>   add a repo",
      '  lineclear card "<q>" --choice a',
      "                                 asks the human",
      '  lineclear status <id> "<line>" --done 5',
      "  lineclear task list",
    ].join("\n"),
  );
});

test("a word both CLIs had goes to the board only by its own arguments", () => {
  expect(isBoardJob("status", ["LINE-1", "reading", "--done", "10"])).toBe(true);
  expect(isBoardJob("status", ["webshop"])).toBe(false);
  expect(isBoardJob("status", ["--plan", "L68"])).toBe(false);
  expect(isBoardJob("plan", ["LINE-1", "--step", "a"])).toBe(true);
  expect(isBoardJob("plan", ["webshop", "a goal"])).toBe(false);
  expect(isBoardJob("card", [])).toBe(true);
  expect(isBoardJob("ask", ["q", "--choice", "a"])).toBe(false);
  expect(isBoardJob("doctor", [])).toBe(false);
});

test("an answer of the board keeps its data and the commands that are not the board's", () => {
  expect(brandedAnswer("Lineclear is restarting: run lineclear merge X-1 again, not lineclear ask")).toBe(
    "Lineclear is restarting: run lineclear merge X-1 again, not lineclear card",
  );
  expect(brandedAnswer("Fix the lineclear import")).toBe("Fix the lineclear import");
});
