import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RichText } from "../ui/kit/rich-text.tsx";

const html = (text: string) => renderToStaticMarkup(createElement(RichText, { text }));

test("a question's links are links and its paths and code are code chips", () => {
  const h = html("See https://example.com/a?b=1. Edit docs/ROADMAP.md and /etc/hosts, then run `bun run check`.");
  expect(h).toContain('href="https://example.com/a?b=1"');
  expect(h).toMatch(/<code[^>]*>docs\/ROADMAP.md<\/code> and/);
  expect(h).toMatch(/<code[^>]*>\/etc\/hosts<\/code>, then/);
  expect(h).toMatch(/<code[^>]*>bun run check<\/code>\./);
});

test("words with a slash and no file stay text", () => {
  expect(html("Use and/or, 3/4 of it, or me@host/x.")).not.toContain("<code");
});
