// The key motions of the app against the board, frame by frame (U41): a pair differs by no more than the threshold
// written in docs/design.md under "Alike with the board".
import { expect, test } from "@playwright/test";
import { compare, holdApp, holdBoard, PAIRS, threshold } from "./alike.ts";

for (const pair of PAIRS) {
  test(`${pair.key} moves like the board`, async ({ page: app, context }, info) => {
    test.skip(info.project.name !== "1440", "a motion does not depend on the width");
    const board = await context.newPage();
    await holdApp(app, pair);
    await holdBoard(board, pair);
    for (const c of await compare(app, board, pair)) {
      const words = `${pair.key} ${c.channel}: app ${c.app.map((v) => v.toFixed(2))}, board ${c.board.map((v) => v.toFixed(2))}`;
      console.log(`${pair.key} ${c.channel} worst ${c.worst.toFixed(3)}`);
      expect(c.worst, words).toBeLessThanOrEqual(threshold());
    }
  });
}
