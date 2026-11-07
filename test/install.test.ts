import { expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadFactor } from "../scripts/check-speed.ts";
import { extensionFile } from "../src/paths.ts";
import { sh } from "./helpers.ts";
import { installFixture } from "./install-fixture.ts";

// Each test runs install.sh for real: 30 s covers an idle machine, and the limit grows with the load.
setDefaultTimeout(30_000 * loadFactor());

const { root, home, repo, stubs, state, service, git, current, env, install, wellButBuild, passes, snapshot, lineclear } = await installFixture();

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
  expect(existsSync(join(current, "bin/lineclear"))).toBe(true);
  expect(existsSync(join(current, ".git"))).toBe(false); // a build has no checkout
  const ext = join(home, ".pi/agent/extensions/lineclear.ts");
  expect(lstatSync(ext).isSymbolicLink()).toBe(false); // pi resolves a link's imports from the link's folder
  expect(readFileSync(ext, "utf8")).toBe(extensionFile(current));
  expect(existsSync(join(current, "ui/web/dist/index.html"))).toBe(true);
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
  expect(d.out).toContain("FAILED stable build"); // a build of a branch is not a release
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
  expect(existsSync(join(current, "newer.txt"))).toBe(true);
  expect(readFileSync(join(state, "systemctl.log"), "utf8")).toContain("--user restart lineclear.service");
  expect(readlinkSync(join(current, "../previous"))).not.toBe(readlinkSync(current)); // the build before it is kept
});

test("doctor names a problem and its fix, and exits 1", () => {
  sh(["rm", "-f", join(home, ".pi/agent/extensions/lineclear.ts")]);
  const d = lineclear("doctor");
  expect(d.code).toBe(1);
  expect(d.out).toContain("FAILED pi extension");
  expect(d.out).toContain("fix: curl -fsSL");
  passes(install());
  wellButBuild(lineclear("doctor"));
});

test("install replaces the link an older install made, and doctor fails a link", () => {
  const ext = join(home, ".pi/agent/extensions/lineclear.ts");
  sh(["ln", "-sfn", join(home, ".local/share/lineclear/pi/extension.ts"), ext]);
  const d = lineclear("doctor");
  expect(d.code).toBe(1);
  expect(d.out).toContain("is a link, so pi cannot find the extension's imports");
  passes(install());
  expect(lstatSync(ext).isSymbolicLink()).toBe(false);
  wellButBuild(lineclear("doctor"));
  writeFileSync(ext, "export default () => {};\n");
  expect(install().code).not.toBe(0); // a file of your own is never overwritten
  rmSync(ext);
  passes(install());
});

test("uninstall keeps settings and secrets, and --all leaves none of Lineclear's files", () => {
  const cfg = join(home, ".config/lineclear/projects/p");
  mkdirSync(cfg, { recursive: true });
  writeFileSync(join(cfg, "secrets.env"), "A=1\n");
  const keep = lineclear("uninstall");
  expect(keep.code).toBe(0);
  expect(existsSync(join(cfg, "secrets.env"))).toBe(true);
  expect(existsSync(join(home, ".local/share/lineclear/.git"))).toBe(false);
  expect(existsSync(join(home, ".local/share/lineclear/store-copies"))).toBe(true); // the copies of the store stay
  passes(install());
  expect(lineclear("uninstall", "--all").code).toBe(0);
  const left = snapshot(home).filter((l) => l.includes("lineclear") && !l.startsWith(".lineclear/")); // .lineclear/ is the server's folder, with this test's fakes
  expect(left).toEqual([]);
  expect(existsSync(join(state, "active"))).toBe(false);
});

test("uninstall removes the old link, and leaves a pi extension of your own", () => {
  const ext = join(home, ".pi/agent/extensions/lineclear.ts");
  passes(install());
  rmSync(ext);
  sh(["ln", "-sfn", join(home, ".local/share/lineclear/pi/extension.ts"), ext]);
  expect(lineclear("uninstall").code).toBe(0);
  expect(sh(["test", "-L", ext]).code).not.toBe(0);
  passes(install());
  rmSync(ext);
  writeFileSync(ext, "export default () => {};\n");
  expect(lineclear("uninstall").code).toBe(0);
  expect(readFileSync(ext, "utf8")).toBe("export default () => {};\n");
  rmSync(ext);
  passes(install());
}, 180_000); // two installs

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

// Last: it leaves a broken commit in the repository.
test("an update from the previous release works, and a failed one goes back to it", () => {
  const release = (version: string) => {
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
    writeFileSync(join(repo, "package.json"), `${JSON.stringify({ ...pkg, version }, null, 2)}\n`);
    git("commit", "-q", "-am", `Release ${version}`);
    git("tag", "-a", `v${version}`, "-m", version);
  };
  const installRelease = (version: string) => sh(["sh", "install.sh"], { env: { ...env(), LINECLEAR_REF: `v${version}` } });
  const builds = join(home, ".lineclear/builds");
  release("1.0.0");
  passes(installRelease("1.0.0"));
  release("1.0.1");
  passes(installRelease("1.0.1"));
  expect(readlinkSync(current)).toBe(join(builds, "1.0.1"));
  expect(readlinkSync(join(builds, "previous"))).toBe(join(builds, "1.0.0"));
  // 1.0.2 answers no chat message: the update goes back to 1.0.1 in one step
  writeFileSync(join(repo, "BROKEN"), "chat\n");
  git("add", "-A");
  release("1.0.2");
  const failed = installRelease("1.0.2");
  expect(failed.code).not.toBe(0);
  expect(failed.out).toContain("back on 1.0.1");
  expect(readlinkSync(current)).toBe(join(builds, "1.0.1"));
  expect(existsSync(join(builds, "previous"))).toBe(false);
}, 240_000); // three builds
