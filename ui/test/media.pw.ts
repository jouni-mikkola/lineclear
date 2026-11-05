// The browser half of `bun run media`: it runs only when bun run media sets MEDIA, in the 1440 project.
// MEDIA=stills shoots the README stills from the running app on its sample data (`?state=filled`). MEDIA=captions sets
// the film's captions in the tokens' font, MEDIA=social lays out the GitHub social preview, MEDIA=release shoots the
// views a release changed. Everything it draws uses ui/brand: tokens.css, its fonts and the wordmark.
import { type Page, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MEDIA = process.env.MEDIA ?? "";
const ARGS = JSON.parse(process.env.MEDIA_ARGS ?? "{}");
const root = join(import.meta.dirname, "..", "..");
const brand = (f: string) => readFileSync(join(root, "ui", "brand", f));

test.skip(MEDIA === "", "only bun run media runs it");
test.skip(({ viewport }) => viewport?.width !== 1440, "one width is enough for the pictures");

/** tokens.css with its fonts inlined, so a page set from a string has them. */
function tokensInline(): string {
  return brand("tokens.css")
    .toString()
    .replace(/url\("\.\/fonts\/([\w.-]+)"\)/g, (_, f) => `url("data:font/woff2;base64,${brand(join("fonts", f)).toString("base64")}")`);
}

async function brandPage(page: Page, size: { width: number; height: number }, body: string, css: string) {
  await page.setViewportSize(size);
  await page.setContent(`<!doctype html><style>${tokensInline()}
    html, body { margin: 0; width: ${size.width}px; height: ${size.height}px; overflow: hidden; }
    body { font-family: var(--lc-font); color: var(--lc-fg); -webkit-font-smoothing: antialiased; }
    ${css}</style>${body}`);
  await page.evaluate(() => document.fonts.ready);
}

/** A view of the running app on its sample data, at rest. */
async function view(page: Page, path: string, file: string) {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.setViewportSize({ width: 1440, height: 900 });
  // as on a device that let Lineclear send alerts, so no view asks for it
  await page.context().grantPermissions(["notifications"]);
  await page.goto(path);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
  // Headless Chromium reports alerts as blocked even when granted: that line is about this device, not Lineclear.
  await page.addStyleTag({ content: "[data-alerts] { visibility: hidden; }" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: file, animations: "disabled" });
}

test("stills", async ({ page }) => {
  test.skip(MEDIA !== "stills");
  for (const s of ARGS.shots as { path: string; file: string }[]) await view(page, s.path, s.file);
});

test("release", async ({ page }) => {
  test.skip(MEDIA !== "release");
  for (const s of ARGS.shots as { path: string; file: string }[]) await view(page, s.path, s.file);
});

test("captions", async ({ page }) => {
  test.skip(MEDIA !== "captions");
  const [width, height] = ARGS.size as [number, number];
  const lines = ARGS.lines as string[];
  for (const [i, line] of lines.entries()) {
    await brandPage(
      page,
      { width, height },
      `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`,
      `body { display: flex; align-items: flex-end; justify-content: center; background: transparent; }
       p { margin: 0 0 ${Math.round(height * 0.07)}px; padding: 10px 20px; border-radius: 12px; font-size: ${Math.round(height * 0.048)}px;
           font-weight: 500; letter-spacing: -0.01em; background: var(--lc-dark); box-shadow: 0 0 0 1px var(--lc-line); }`,
    );
    await page.screenshot({ path: join(ARGS.out, `caption-${i}.png`), omitBackground: true });
  }
});

test("social", async ({ page }) => {
  test.skip(MEDIA !== "social");
  const poster = `data:image/png;base64,${readFileSync(ARGS.poster).toString("base64")}`;
  const wordmark = brand("wordmark.svg").toString();
  await brandPage(
    page,
    { width: 1280, height: 640 },
    `<img class="poster" src="${poster}" alt=""><div class="fade"></div>
     <main><div class="mark">${wordmark}</div><h1>${ARGS.tagline}</h1><p>${ARGS.version}</p></main>`,
    `body { background: var(--lc-base); position: relative; }
     .poster { position: absolute; right: -120px; top: 40px; width: 1000px; }
     .poster { -webkit-mask-image: linear-gradient(90deg, transparent 12%, var(--lc-base) 34%), linear-gradient(180deg, transparent, var(--lc-base) 14%, var(--lc-base) 86%, transparent);
       -webkit-mask-composite: source-in; mask-composite: intersect; }
     .fade { position: absolute; inset: 0; background: linear-gradient(90deg, var(--lc-base) 34%, transparent 58%); }
     main { position: absolute; left: 80px; top: 0; bottom: 0; width: 520px; display: flex; flex-direction: column; justify-content: center; }
     .mark svg { width: 330px; height: auto; display: block; }
     h1 { margin: 40px 0 0; font-size: 44px; line-height: 1.15; font-weight: 600; letter-spacing: -0.02em; }
     p { margin: 24px 0 0; font-family: var(--lc-font-mono); font-size: 18px; color: var(--lc-fg3); }`,
  );
  await page.screenshot({ path: ARGS.out });
});
