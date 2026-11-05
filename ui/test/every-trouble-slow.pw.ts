// U37: every view under a slow API shows its designed state (U34).
import { test } from "@playwright/test";
import { open } from "./open.ts";
import { everyView, noticed } from "./trouble.ts";

test.use({ timezoneId: "UTC" });

test("a slow API: every view keeps its data under a quiet bar", async ({ page, context }) => {
  await open(page, "/");
  const pages = await everyView(context, page);
  await context.route("**/api/**", async (r) => {
    if (r.request().url().includes("/api/chat/events") || r.request().url().includes("/api/live")) return r.fallback();
    await new Promise((done) => setTimeout(done, 6500));
    await r.continue().catch(() => undefined);
  });
  await noticed(pages, "slow");
});
