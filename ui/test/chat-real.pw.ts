// The Dispatcher's chat entry: a way in from Home on a phone, and a Chat pill that is not the colour of broken.
import { expect, test } from "@playwright/test";

test("Home on a phone has a chat entry that brings the composer into view", async ({ page, viewport }) => {
  test.skip(viewport?.width !== 390, "a phone only");
  await page.goto("/");
  const entry = page.locator("[data-chat-entry]");
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.locator("[data-chat-column] [data-composer]")).toBeInViewport();
});

test("the Chat entry is not drawn in the colour of broken", async ({ page, viewport }) => {
  const wide = viewport?.width === 1440;
  await page.goto(wide ? "/settings" : "/");
  const entry = page.locator(wide ? "[data-chat-open]" : "[data-chat-entry]");
  await expect(entry).toBeVisible();
  const colours = await entry.evaluate((el) => {
    const css = getComputedStyle(document.documentElement);
    const rgb = (value: string) => {
      const probe = document.createElement("i");
      probe.style.color = value;
      document.body.append(probe);
      const out = getComputedStyle(probe).color;
      probe.remove();
      return out;
    };
    const used = [el, el.querySelector("svg")].flatMap((n) => (n ? [getComputedStyle(n).color, getComputedStyle(n).borderTopColor] : []));
    return { used, banned: [css.getPropertyValue("--lc-stop"), css.getPropertyValue("--lc-accent")].map(rgb) };
  });
  for (const colour of colours.used) expect(colours.banned).not.toContain(colour);
});
