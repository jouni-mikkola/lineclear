import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BrowserCard, type Browser, splitSessions } from "../ui/kit/browsers.tsx";
import { type Machine, MachineCard, machineLook } from "../ui/kit/settings.tsx";
import { browserSamples } from "../ui/web/browser-samples.ts";

// What Settings and Browsers show, on sample data (U14).

const ready: Machine = { host: "here", local: true, state: "ready", load: 1, limit: 8 };
const busy: Machine = { host: "build-box", local: false, state: "ready", load: 9.5, limit: 8 };

test("a machine over its load limit reads busy in grey, never amber, green or red", () => {
  expect(machineLook(busy)).toBe("busy");
  const card = renderToStaticMarkup(createElement(MachineCard, { m: busy }));
  expect(card).toContain('data-look="busy"');
  expect(card).toContain("busy, new tasks wait");
  expect(card).toContain('data-shape="queued"');
  expect(card).not.toContain('data-shape="need"');
  expect(card).not.toContain("caution");
  expect(card).not.toContain('data-shape="done"');
  expect(card).not.toContain(">ready<");
});

test("a browser card shows its task, its project and the page's host, not the page title", () => {
  const b: Browser = {
    session: "WEB-2",
    title: "Search that forgives typos",
    task: "WEB-2",
    project: "web-shop",
    page: { title: "Results page", url: "http://localhost:5173/search?q=x" },
    taken: false,
  };
  const card = renderToStaticMarkup(createElement(BrowserCard, { b, picture: "/p", href: "/browsers/WEB-2" }));
  expect(card).toContain("Search that forgives typos");
  expect(card).toContain("WEB-2 · web-shop");
  expect(card).toContain("localhost:5173");
  expect(card).not.toContain("Results page");
});

test("a session with no task folds under Other sessions, unless it waits for you", () => {
  const { tasks, other } = splitSessions(browserSamples("filled"));
  expect(other.map((b) => b.session)).toEqual(["docs-preview"]);
  expect(tasks.every((b) => b.task)).toBe(true);
  const asks: Browser = { session: "scratch", title: "scratch", waits: { item: "4", question: "Sign in." }, taken: false };
  expect(splitSessions([asks]).tasks).toEqual([asks]);
});

test("a card has a placeholder with the page's host until its first picture comes", () => {
  const b: Browser = { session: "WEB-2", title: "Search", task: "WEB-2", page: { title: "", url: "https://shop.example.com/a" }, taken: false };
  const card = renderToStaticMarkup(createElement(BrowserCard, { b, picture: "/api/browsers/WEB-2/picture", href: "#" }));
  expect(card).toContain('data-picture="loading"');
  expect(card).toContain("data-placeholder");
  expect(card).toContain("shop.example.com");
});

test("load over the limit is busy, never a fault; a real fault shows its reason on the card", () => {
  const over: Machine = { host: "laptop", local: true, state: "ready", load: 16.28, limit: 16 };
  expect(machineLook(over)).toBe("busy");
  expect(machineLook({ ...over, state: "failed" })).toBe("broken");
  const card = renderToStaticMarkup(createElement(MachineCard, { m: over }));
  expect(card).toContain("busy, new tasks wait");
  expect(card).not.toContain("needs a fix");
  expect(card).not.toContain("data-fault");
  const bad: Machine = { host: "old", local: false, state: "failed", doctor: ["ok git", "FAILED no coordinator on a timer: 1 space"] };
  expect(renderToStaticMarkup(createElement(MachineCard, { m: bad }))).toContain("no coordinator on a timer: 1 space");
});

test("an unreachable machine's reason is not said twice, and a passing doctor line is no reason", () => {
  const gone: Machine = { host: "gone", local: false, state: "unreachable" };
  expect(renderToStaticMarkup(createElement(MachineCard, { m: gone }))).not.toContain("data-fault");
  const odd: Machine = { host: "odd", local: false, state: "failed", doctor: ["ok     git", "install.sh failed (exit 1)."] };
  expect(renderToStaticMarkup(createElement(MachineCard, { m: odd }))).toContain("install.sh failed");
});

test("a broken machine has a Fix button and no command, a machine behind has Update", () => {
  const bad: Machine = {
    host: "old",
    local: false,
    state: "failed",
    doctor: ["FAILED service: not running", "       fix: systemctl --user enable --now lineclear.service"],
  };
  const card = renderToStaticMarkup(createElement(MachineCard, { m: bad, onRetry: () => {} }));
  expect(card).toContain(">Fix<");
  expect(card).not.toContain("systemctl");
  const behind: Machine = { ...ready, local: false, version: "abc1234", behind: true };
  expect(renderToStaticMarkup(createElement(MachineCard, { m: behind, onRetry: () => {} }))).toContain(">Update<");
});
