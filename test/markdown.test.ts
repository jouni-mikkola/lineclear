import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { imageSrc, Markdown } from "../ui/kit/markdown.tsx";

const html = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

test("an answer's markdown: emphasis, code, lists, links and tables", () => {
  const out = html(
    "**web-shop** is *on track*, see `src/app.ts`.\n\n- one\n- two\n\n1. first\n2. second\n\n```ts\nconst a = 1 < 2;\n```\n\n| Task | State |\n| --- | --- |\n| Gift cards | queued |\n\n[Docs](https://example.com/docs)",
  );
  expect(out).toContain("<strong");
  expect(out).toContain(">web-shop</strong>");
  expect(out).toContain("<em");
  expect(out).toMatch(/<code[^>]*>src\/app\.ts<\/code>/);
  expect(out).toMatch(/<ul[^>]*>.*<li[^>]*>.*one.*<\/li>.*two.*<\/ul>/s);
  expect(out).toMatch(/<ol[^>]*>.*first.*second.*<\/ol>/s);
  expect(out).toContain("const a = 1 &lt; 2;");
  expect(out).toMatch(/<table.*<th[^>]*>Task<\/th>.*<td[^>]*>Gift cards<\/td>/s);
  expect(out).toMatch(/<a href="https:\/\/example.com\/docs" target="_blank" rel="noopener noreferrer"[^>]*>Docs<\/a>/);
});

test("nothing in an answer runs: HTML stays text, and a link goes only to the web or mail", () => {
  const out = html('<img src=x onerror="alert(1)"> [click](javascript:alert(1)) ![x](javascript:alert(1))');
  expect(out).not.toContain('<img src="x"');
  expect(out).toContain("&lt;img src=x");
  expect(out).not.toContain("javascript:");
  expect(out).not.toContain("href=");
});

test("an image an answer names shows from the web, the text itself, or the server's own folders", () => {
  // a web image would load with no click and tell another site what its address holds: it is a link
  expect(imageSrc("https://example.com/a.png?d=secret")).toBeUndefined();
  expect(html("![chart](https://example.com/a.png?d=secret)")).not.toContain("<img");
  expect(html("![chart](https://example.com/a.png?d=secret)")).toMatch(/<a href="https:\/\/example.com\/a.png\?d=secret"[^>]*>chart<\/a>/);
  expect(imageSrc("/home/me/.config/lineclear/dispatcher/chart.png")).toBe("/api/chat/image?path=%2Fhome%2Fme%2F.config%2Flineclear%2Fdispatcher%2Fchart.png");
  expect(imageSrc("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
  expect(imageSrc("data:text/html,<script>")).toBeUndefined();
  expect(imageSrc("relative.png")).toBeUndefined();
  expect(html("![Chart](/tmp/chart.png)")).toContain('src="/api/chat/image?path=%2Ftmp%2Fchart.png"');
});
