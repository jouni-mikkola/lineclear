import { expect, test } from "bun:test";

test("bin/lineclear runs the CLI in process and exits with its code", async () => {
  const exit = process.exit;
  const log = console.log;
  const argv = process.argv;
  let code: number | undefined;
  process.exit = ((c?: number) => {
    code = c;
  }) as typeof process.exit;
  console.log = () => {};
  process.argv = [argv[0] as string, "bin/lineclear", "--help"];
  try {
    await import(new URL("../bin/lineclear", import.meta.url).pathname);
  } finally {
    process.exit = exit;
    console.log = log;
    process.argv = argv;
  }
  expect(code).toBe(0);
});

test("bin/lineclear names an unknown command even where the stable folders would be used", () => {
  const p = Bun.spawnSync(["bin/lineclear", "nope"], { env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" } });
  expect(p.exitCode).toBe(2);
  expect((p.stdout.toString() + p.stderr.toString()).trim()).toBe("lineclear: unknown command 'nope', try 'lineclear --help'");
});
