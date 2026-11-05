// Every letter in every state the pictures show is drawn in the font served from ui/brand, never in a font of the
// machine. So the pictures do not depend on the machine's fonts.
import { expect, test } from "@playwright/test";
import { CHAT_STATES } from "../web/samples.ts";
import { PAGE_STATES } from "./bar.ts";

const PAGES: [string, readonly string[]][] = [
  ["/design", PAGE_STATES],
  ["/", [...PAGE_STATES, "idle", "clear", "thirty", "offline"]],
  ["/settings", PAGE_STATES],
  ["/web-shop/roadmap", PAGE_STATES],
  ["/chat", CHAT_STATES],
];
const SERVED = ["Geist", "Geist Mono"];

test.skip(({ viewport }) => viewport?.width !== 1440, "the fonts are checked once, at 1440 px");

for (const [path, states] of PAGES) {
  test(`letters on ${path} are drawn in Geist, in every state`, async ({ page }) => {
    test.slow(); // one CDP call per node of every state
    const cdp = await page.context().newCDPSession(page);
    const others: Record<string, string[]> = {};
    for (const state of states) {
      await page.goto(`${path}?state=${state}`);
      await page.evaluate(() => document.fonts.ready);
      await cdp.send("DOM.enable");
      await cdp.send("CSS.enable");
      const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
      const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: "body *" });
      for (const nodeId of nodeIds) {
        const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
        for (const f of fonts) if (!SERVED.includes(f.familyName)) (others[f.familyName] ??= []).push(state);
      }
    }
    expect(others).toEqual({});
  });
}
