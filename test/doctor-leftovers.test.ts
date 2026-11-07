import { expect, test } from "bun:test";
import { doctor, type Probe } from "../src/doctor.ts";
import type { Leftovers } from "../src/doctor-leftovers.ts";
import { pathsFor } from "../src/paths.ts";

const paths = pathsFor({ HOME: "/nonexistent-home" });
const probe = (leftovers: Leftovers): Probe => ({
  dataDir: "/nonexistent-home/data",
  paths,
  pathDirs: [],
  which: () => null,
  run: () => null,
  leftovers: () => leftovers,
});
const live = "/h/.herdr/worktrees/lineclear/work-1-live";
const ofKind = (p: Probe, prefix: string) => {
  const out: string[] = [];
  const code = doctor(p, (l) => out.push(l));
  return { code, lines: out.filter((l) => l.startsWith(prefix) && l.includes("leftover")) };
};

test("one leftover of each kind gives four lines and a non-zero exit", () => {
  const planted = probe({
    live: [live],
    found: {
      worktrees: [live, "/h/.herdr/worktrees/lineclear/work-2-old"],
      branches: ["work/1-live", "work/2-old"],
      sessions: ["--h--herdr-worktrees-lineclear-work-1-live--", "--h--herdr-worktrees-lineclear-work-2-old--"],
      panes: [live, "/h/.herdr/worktrees/lineclear/work-2-old"],
    },
  });
  const { code, lines } = ofKind(planted, "FAILED");
  expect(lines).toHaveLength(4);
  expect(code).toBe(1);
});

test("a clean fixture prints 0s for the four kinds and these checks never fail it", () => {
  const clean = probe({
    live: [live],
    found: { worktrees: [live], branches: ["work/1-live"], sessions: ["--h--herdr-worktrees-lineclear-work-1-live--"], panes: [live] },
  });
  const { lines } = ofKind(clean, "ok");
  expect(lines).toHaveLength(4);
  expect(lines.every((l) => l.endsWith(": 0"))).toBe(true);
  expect(ofKind(clean, "FAILED").lines).toHaveLength(0);
});
