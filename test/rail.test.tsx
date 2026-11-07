import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { INK } from "../ui/brand/rail.ts";
import { Typing } from "../ui/kit/chat.tsx";
import { roleCounts } from "../ui/kit/how.tsx";
import { type Project, ProjectCard } from "../ui/kit/parts.tsx";

test("the parts' inks are the tokens' colours, so the README draws what the views draw", () => {
  const css = readFileSync(join(import.meta.dir, "..", "ui", "brand", "tokens.css"), "utf8");
  for (const [ink, hex] of Object.entries(INK)) {
    if (ink === "dark") continue;
    expect(new RegExp(`--lc-${ink}:\\s*([^;]+);`).exec(css)?.[1]?.trim(), `--lc-${ink}`).toBe(hex);
  }
});

const project = (p: Partial<Project>): Project => ({ name: "shop", done: 0, total: 0, unit: "steps", broken: false, tasks: [], ...p });

test("the Home chain counts tasks at work, checks and asks", () => {
  const projects = [
    project({
      done: 3,
      total: 8,
      tasks: [
        { id: "1", title: "a", state: "work" },
        { id: "2", title: "b", state: "work", stage: "review" },
        { id: "3", title: "c", state: "queued" },
        { id: "4", title: "d", state: "need" },
      ],
    }),
    project({ name: "blog", unit: "tasks", done: 2, total: 2 }),
  ];
  const c = roleCounts(projects, 1);
  expect(c.worker?.text).toBe("2 at work");
  expect(c.reviewer?.text).toBe("1 checking");
  expect(c.rules?.text).toBe("1 in line");
  expect(c.dispatcher?.text).toBe("2 projects");
  expect(c.inbox?.text).toBe("1 waits for you");
  const calm = roleCounts([project({})]);
  expect(calm.inbox?.text).toBe("nothing waits for you");
});

test("a role is lit while it has work in hand, and its beat goes up when it takes something new", () => {
  const quiet = roleCounts([project({})], 0, {});
  expect(quiet.dispatcher?.live).toBe(false);
  expect(quiet.planner?.live).toBe(false);
  const busy = roleCounts([project({})], 2, { planning: 1, sends: 3, sending: true });
  expect(busy.dispatcher).toMatchObject({ live: true, beat: 3, text: "reading your request" });
  expect(busy.planner).toMatchObject({ live: true, beat: 1 });
  expect(busy.you).toMatchObject({ live: true, you: true, beat: 2 });
});

test("amber is only what waits for you: a blocker you cannot open and the Dispatcher's typing dots are grey", () => {
  const blocked = renderToStaticMarkup(<ProjectCard p={project({ phase: "Build", blocker: { text: "waits for a free slot" } })} />);
  expect(blocked).toContain("waits for a free slot");
  expect(blocked).not.toMatch(/caution/);
  const yours = renderToStaticMarkup(<ProjectCard p={project({ phase: "Build", blocker: { text: "waits for you", href: "/inbox" } })} />);
  expect(yours).toMatch(/text-caution/);
  expect(renderToStaticMarkup(<Typing doing="reading the roadmap" />)).not.toMatch(/caution/);
});
