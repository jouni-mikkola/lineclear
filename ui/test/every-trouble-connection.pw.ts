// U37: every view with a lost connection and with a stopped service shows its designed state (U34).
import { test } from "@playwright/test";
import { open } from "./open.ts";
import { everyView, noticed } from "./trouble.ts";

test.use({ timezoneId: "UTC" });

test("a lost connection: every view keeps its data and says it is quiet", async ({ page, context }) => {
  await open(page, "/");
  const pages = await everyView(context, page);
  await context.setOffline(true);
  await noticed(pages, "lost");
});

test("a stopped service: every view keeps its data and says it is red", async ({ page, context }) => {
  await open(page, "/");
  const pages = await everyView(context, page);
  await context.route("**/api/**", (r) => r.abort("connectionrefused"));
  await noticed(pages, "stopped");
});
