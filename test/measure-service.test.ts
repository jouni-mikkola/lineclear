import { expect, test } from "bun:test";
import { judge } from "../scripts/measure-service.ts";

const at = (invocation: string, cpuSec: number, peakMb: number, atSec: number) => ({
  invocation,
  cpuNs: cpuSec * 1e9,
  peakBytes: peakMb * 1024 * 1024,
  atMs: atSec * 1000,
});

test("light: 36 s of CPU in an hour is 1 %", () => {
  const r = judge([at("a", 0, 80, 0), at("a", 36, 120, 3600)]);
  expect(r.cpuPercent).toBeCloseTo(1, 5);
  expect(r.ok).toBe(true);
});

test("too heavy by CPU or by memory", () => {
  expect(judge([at("a", 0, 80, 0), at("a", 100, 120, 3600)]).ok).toBe(false);
  expect(judge([at("a", 0, 80, 0), at("a", 10, 301, 3600)]).ok).toBe(false);
});

test("a restart drops its step and is counted", () => {
  const r = judge([at("a", 0, 80, 0), at("a", 10, 90, 100), at("b", 1, 70, 130), at("b", 11, 90, 230)]);
  expect(r.restarts).toBe(1);
  expect(r.seconds).toBe(200);
  expect(r.cpuPercent).toBeCloseTo(10, 5);
});
