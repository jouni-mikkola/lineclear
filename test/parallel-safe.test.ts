import { describe, expect, test } from "bun:test";
import { parallelFaults } from "../scripts/gates/parallel-safe.ts";

const faults = (...lines: string[]) => parallelFaults("test/x.test.ts", lines.join("\n"));

describe("the parallel-safe gate", () => {
  test("fails a fixed port", () => {
    expect(faults("Bun.serve({ port: 7421, fetch })")[0]).toContain("fixed port");
    expect(faults("server.listen(8080)")[0]).toContain("fixed port");
  });
  test("passes port 0 and a configured port", () => {
    expect(faults("Bun.serve({ port: 0, fetch })", "expect(webAddress({})).toEqual({ port: 7420 })")).toEqual([]);
  });
  test("fails a write outside the temp folder", () => {
    expect(faults('writeFileSync("/etc/x", "a")')[0]).toContain("outside its temp folder");
    expect(faults("rmSync(homedir())")[0]).toContain("outside its temp folder");
    expect(faults('writeFileSync(join(dir, "x"), "a")')).toEqual([]);
  });
  test("fails a counted loop of sleeps", () => {
    expect(faults("for (let i = 0; i < 50 && !ok(); i++) await Bun.sleep(100)")[0]).toContain("fixed count of sleeps");
    expect(faults("for (let i = 0; i < 5; i++) {", "  await tick()", "  await Bun.sleep(10)", "}")[0]).toContain("fixed count of sleeps");
  });
  test("passes a counted loop that does not sleep", () => {
    expect(faults("for (let i = 0; i < 100; i++) await m.act(i)", "await Bun.sleep(100)")).toEqual([]);
  });
  test("every test of the repo passes", async () => {
    const { parallelSafe } = await import("../scripts/gates/parallel-safe.ts");
    expect(await parallelSafe(`${import.meta.dir}/..`)).toEqual([]);
  });
});
