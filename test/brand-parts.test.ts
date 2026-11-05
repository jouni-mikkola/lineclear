import { expect, test } from "bun:test";
import { at, engine, hex, planner, points, siding, svgOf, train } from "../ui/brand/rail.ts";

test("a train that hauls cargo draws a wagon, full when loaded past 90 %, and none when queued or off", () => {
  const plain = train("work", hex);
  const loaded = train("work", hex, { load: 0.5 });
  const full = train("work", hex, { load: 1 });
  expect(loaded.length).toBe(plain.length + 3);
  expect(JSON.stringify(full)).toContain('"data-cargo":1');
  expect(train("queued", hex, { load: 0.5 })).toHaveLength(train("queued", hex).length);
  expect(train("off", hex, { load: 0.5 })).toHaveLength(1);
  expect(train("stalled", hex, { load: 0.2 }).length).toBeGreaterThan(train("stalled", hex).length);
});

test("points turn their blade off the main track, and a siding ends at a buffer stop", () => {
  expect(JSON.stringify(points(hex, true))).toContain("rotate(40deg)");
  expect(JSON.stringify(points(hex))).toContain("rotate(0deg)");
  expect(JSON.stringify(siding(hex, 30))).toContain("M31 -4.5V4.5");
  expect(planner(hex)).toHaveLength(1);
});

test("an engine shows its fill only when it is given, and svgOf draws the shapes", () => {
  expect(JSON.stringify(engine(hex))).not.toContain("data-fill");
  expect(JSON.stringify(engine(hex, { w: 60, fill: 0.5 }))).toContain('"data-fill":0.5');
  expect(svgOf([at(1, 2, planner(hex))])).toContain("translate(1 2)");
});
