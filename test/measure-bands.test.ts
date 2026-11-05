import { expect, test } from "bun:test";
import { addCall, bandLines, emptyBands, mergeBands } from "../src/measure-bands.ts";

const call = (prompt: number, output = 0) => ({ provider: "p", model: "m", input: 0, output, cacheRead: prompt, cacheWrite: 0 });

test("a call lands in the band of its prompt, edges belong to the lower band", () => {
  const bands = emptyBands();
  addCall(bands, call(10_000), 0.01);
  addCall(bands, call(50_000), 0.05);
  addCall(bands, call(50_001), 0.07);
  addCall(bands, call(200_000, 500), 0.4);
  expect(bands.map((b) => [b.band, b.calls])).toEqual([
    ["0-20k", 1],
    ["20-50k", 1],
    ["50-80k", 1],
    ["80-120k", 0],
    ["120-150k", 0],
    ["150k+", 1],
  ]);
  expect(bands[5]).toEqual({ band: "150k+", calls: 1, dollars: 0.4, tokens: 200_500 });
});

test("the table prints dollars per call and the share of the cost, and leaves out empty bands", () => {
  const bands = emptyBands();
  addCall(bands, call(10_000), 0.1);
  addCall(bands, call(60_000), 0.1);
  addCall(bands, call(70_000), 0.2);
  const more = emptyBands();
  addCall(more, call(60_000), 0.2);
  mergeBands(bands, more);
  expect(bandLines(bands)).toEqual([
    "cost per call, context 0-20k: 1 calls, $0.100 per call, 16.7 % of the cost",
    "cost per call, context 50-80k: 3 calls, $0.167 per call, 83.3 % of the cost",
  ]);
  expect(bandLines(emptyBands())).toEqual(["cost per call by context band: no priced call of a merged step yet"]);
});
