import { expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extensionFile } from "../src/paths.ts";
import { installHarness } from "./install-harness.ts";

const { root, home, repo, stubs, state, git, service, install, passes, wellButBuild, lineclear, snapshot } = await installHarness("install");

test("install adds Lineclear, the extension and the service, and doctor passes", () => {
  const extDir = join(home, ".pi/agent/extensions");
  mkdirSync(extDir, { recursive: true });
  for (const f of ["quota-switch.ts", "quota-switch.json", "api-guard.ts", "claude-bridge-b.ts"]) writeFileSync(join(extDir, f), "// left by an older tool\n");
  const r = install();
  passes(r);
  // the account fallback is native now; the bridge's second account stays
  for (const f of ["quota-switch.ts", "quota-switch.json", "api-guard.ts"]) expect(existsSync(join(extDir, f))).toBe(false);
  expect(existsSync(join(extDir, "claude-bridge-b.ts"))).toBe(true);
  expect(existsSync(join(state, "lineclear"))).toBe(false); // no herdr-projects 2.0 plugin
  expect(existsSync(join(home, ".local/share/lineclear/bin/lineclear"))).toBe(true);
  const ext = join(home, ".pi/agent/extensions/lineclear.ts");
  expect(lstatSync(ext).isSymbolicLink()).toBe(false); // pi resolves a link's imports from the link's folder
  expect(readFileSync(ext, "utf8")).toBe(extensionFile(join(home, ".local/share/lineclear")));
  expect(existsSync(join(home, ".local/share/lineclear/ui/web/dist/index.html"))).toBe(true);
  expect(readFileSync(join(home, ".config/systemd/user/lineclear.service"), "utf8")).toContain("lineclear run");
  const unit = readFileSync(join(home, ".config/systemd/user/lineclear.service"), "utf8");
  expect(unit).toMatch(/^Environment="PATH=.+"$/m);
  expect(unit).toContain(`:${stubs}:`);
  expect(readFileSync(join(state, "tailscale.log"), "utf8")).toContain(`serve --bg --https=${service.port} http://127.0.0.1:${service.port}`); // the web and board ports are published
  expect(existsSync(join(state, "linger"))).toBe(true); // lingering is on, so the service starts at boot
  // the compile cache goes to the disk cache for every user service and session
  expect(readFileSync(join(home, ".config/environment.d/60-lineclear.conf"), "utf8")).toBe(
    `NODE_COMPILE_CACHE=${join(root, "cache/lineclear/node-compile-cache")}\n`,
  );
  const d = lineclear("doctor");
  expect(d.out).toContain("ok     starts at boot");
  expect(d.out).toContain("ok     compile cache on disk");
  wellButBuild(d);
  expect(d.out).toContain("FAILED stable build");
}, 180_000); // the first full build of the app and its web pages, then a doctor run

test("where lingering needs root, install prints the one command and doctor names it", () => {
  rmSync(join(state, "linger"), { force: true });
  writeFileSync(join(state, "linger-needs-root"), "");
  const r = install();
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/Run this once: sudo loginctl enable-linger \S+/);
  const d = lineclear("doctor");
  expect(d.code).toBe(1);
  expect(d.out).toMatch(/FAILED starts at boot: lingering is off/);
  expect(d.out).toMatch(/fix: sudo loginctl enable-linger/);
  rmSync(join(state, "linger-needs-root"));
  passes(install());
  wellButBuild(lineclear("doctor"));
}, 180_000); // two installs and two doctor runs

test("a second install changes no file", () => {
  const before = snapshot(home);
  const r = install();
  expect(r.code).toBe(0);
  expect(snapshot(home)).toEqual(before);
}, 180_000); // a full install after a snapshot of the home folder

test("install again updates Lineclear to the newest commit", () => {
  writeFileSync(join(repo, "newer.txt"), "newer\n");
  git("add", "-A");
  git("commit", "-q", "-m", "second");
  const r = install();
  expect(r.code).toBe(0);
  expect(existsSync(join(home, ".local/share/lineclear/newer.txt"))).toBe(true);
  expect(readFileSync(join(state, "systemctl.log"), "utf8")).toContain("--user restart lineclear.service");
});

test("the README names the install variables and the fork's notice, and the license exists", () => {
  const readme = readFileSync(join(import.meta.dir, "../README.md"), "utf8");
  expect(readme).toContain("LINECLEAR_REPO");
  expect(readme).toContain("server/NOTICE");
  expect(readFileSync(join(import.meta.dir, "../LICENSE"), "utf8")).toContain("MIT License");
  const notice = readFileSync(join(import.meta.dir, "../server/NOTICE"), "utf8");
  expect(notice).toContain("server/LICENSE");
  expect(notice).toContain("Permission is hereby granted");
  expect(notice).toContain("Elias Stravik");
  const forkLicense = readFileSync(join(import.meta.dir, "../server/LICENSE"), "utf8");
  expect(forkLicense).toContain("MIT License");
  expect(forkLicense).toContain("Elias Stravik");
});
