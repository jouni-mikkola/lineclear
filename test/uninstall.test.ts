import { expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cacheEnvFile, extensionFile, pathsFor } from "../src/paths.ts";
import { realRemover, uninstall } from "../src/uninstall.ts";
import { tmp } from "./helpers.ts";

function world() {
  const home = tmp("uninstall");
  const paths = pathsFor({ HOME: home });
  const put = (file: string, text = "x") => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  put(join(paths.app, "marker"));
  put(join(paths.app, "store-copies", "task.json"));
  put(paths.unit);
  put(join(dirname(paths.unit), "lineclear-herdr.service"));
  put(join(dirname(paths.unit), "lineclear-track.timer"));
  put(join(paths.config, "settings.json"));
  put(paths.cacheEnv, cacheEnvFile({ HOME: home }));
  mkdirSync(dirname(paths.binLink), { recursive: true });
  symlinkSync(join(paths.app, "bin", "lineclear"), paths.binLink);
  put(paths.extension, extensionFile(paths.app));
  const ran: string[] = [];
  const lines: string[] = [];
  const remover = { paths, run: (cmd: string[]) => void ran.push(cmd.join(" ")) };
  return { paths, ran, lines, remover, out: (l: string) => void lines.push(l) };
}

test("uninstall removes the units, the track timer, the link and the extension, and keeps the settings and the store copies", () => {
  const w = world();
  expect(uninstall(w.remover, false, w.out)).toBe(0);
  expect(existsSync(w.paths.unit)).toBe(false);
  expect(existsSync(w.paths.extension)).toBe(false);
  expect(existsSync(join(w.paths.app, "marker"))).toBe(false);
  expect(existsSync(join(w.paths.app, "store-copies", "task.json"))).toBe(true);
  expect(existsSync(join(w.paths.config, "settings.json"))).toBe(true);
  expect(w.ran).toContain("systemctl --user disable --now lineclear-track.timer");
  expect(w.lines.some((l) => l.startsWith("Removed the test track's timer"))).toBe(true);
  expect(w.lines.some((l) => l.startsWith("Kept the project settings"))).toBe(true);
});

test("uninstall --all removes the settings too, and leaves a link that is not Lineclear's", () => {
  const w = world();
  const other = join(tmp("other"), "target");
  writeFileSync(other, "x");
  rmSync(w.paths.binLink);
  symlinkSync(other, w.paths.binLink);
  uninstall(w.remover, true, w.out);
  expect(existsSync(w.paths.config)).toBe(false);
  expect(existsSync(w.paths.app)).toBe(false);
  expect(existsSync(w.paths.binLink)).toBe(true);
  expect(w.lines.some((l) => l.startsWith(`Left ${w.paths.binLink}`))).toBe(true);
});

test("the real remover ignores a command that cannot run", () => {
  expect(() => realRemover(pathsFor({ HOME: "/nonexistent-home" })).run(["/nonexistent-command-xyz"])).not.toThrow();
});

test("uninstall removes the NODE_COMPILE_CACHE setting", () => {
  const w = world();
  uninstall(w.remover, false, w.out);
  expect(existsSync(w.paths.cacheEnv)).toBe(false);
  expect(w.ran).toContain("systemctl --user unset-environment NODE_COMPILE_CACHE");
});
