import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BrowserCard, type Browser, splitSessions } from "../ui/kit/browsers.tsx";
import { browserSamples } from "../ui/test/browser-samples.ts";

// What Browsers show, on sample data (U14).

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
