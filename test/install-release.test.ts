import { expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadFactor } from "../scripts/check-speed.ts";
import { sh } from "./helpers.ts";
import { installFixture } from "./install-fixture.ts";

// Each test runs install.sh for real: 30 s covers an idle machine, and the limit grows with the load.
setDefaultTimeout(30_000 * loadFactor());

const { root, repo, stubs, service, git, passes, env } = await installFixture();

test("a release installs into builds/<version>, the service and the command run from current, and a newer one becomes current with the first as previous", () => {
  const home2 = join(root, "home-release");
  mkdirSync(join(home2, ".lineclear"), { recursive: true });
  writeFileSync(join(home2, ".lineclear/server.json"), JSON.stringify({ port: service.port }));
  const releaseEnv = (tag: string) => ({ ...env(), HOME: home2, PATH: `${join(home2, ".local/bin")}:${stubs}:${process.env.PATH}`, LINECLEAR_REF: tag });
  const release = (version: string) => {
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
    writeFileSync(join(repo, "package.json"), `${JSON.stringify({ ...pkg, version }, null, 2)}\n`);
    git("commit", "-q", "-am", `Release ${version}`);
    git("tag", "-a", `v${version}`, "-m", version);
  };
  const installRelease = (version: string) => sh(["sh", "install.sh"], { env: releaseEnv(`v${version}`) });
  const builds = join(home2, ".lineclear/builds");
  const unit = () => readFileSync(join(home2, ".config/systemd/user/lineclear.service"), "utf8");

  release("1.0.0");
  passes(installRelease("1.0.0"));
  expect(sh(["readlink", join(builds, "current")]).out.trim()).toBe(join(builds, "1.0.0"));
  expect(existsSync(join(builds, "1.0.0/.git"))).toBe(false);
  expect(existsSync(join(builds, "1.0.0/ui/web/dist/index.html"))).toBe(true);
  expect(unit()).toContain(`${builds}/current/bin/lineclear run`);
  expect(unit()).not.toContain(repo);
  expect(sh(["readlink", "-f", join(home2, ".local/bin/lineclear")]).out.trim()).toBe(join(builds, "1.0.0/bin/lineclear"));
  expect(existsSync(join(builds, "previous"))).toBe(false);
  const doctor = () => sh([join(home2, ".local/bin/lineclear"), "doctor"], { env: releaseEnv("v1.0.0") });
  expect(doctor().out).toContain("ok     stable build");
  // every installed file names the stable path: the extension pi loads, the unit and the command link
  const installed = [".pi/agent/extensions/lineclear.ts", ".config/systemd/user/lineclear.service"];
  for (const file of installed) {
    const text = readFileSync(join(home2, file), "utf8");
    expect(text).toContain(`${builds}/current/`);
    expect(text).not.toMatch(/\/builds\/(?!current\/)/);
    expect(text).not.toContain(repo);
  }
  expect(sh(["readlink", join(home2, ".local/bin/lineclear")]).out.trim()).toBe(join(builds, "current/bin/lineclear"));
  // nothing else Lineclear wrote outside builds/ names a build folder other than current
  const strays = sh(["grep", "-rIlE", "/builds/(1\\.|previous)", home2, "--exclude-dir=builds"]);
  expect(strays.out.trim()).toBe("");

  release("1.0.1");
  passes(installRelease("1.0.1"));
  expect(sh(["readlink", join(builds, "current")]).out.trim()).toBe(join(builds, "1.0.1"));
  expect(sh(["readlink", join(builds, "previous")]).out.trim()).toBe(join(builds, "1.0.0"));
  expect(doctor().out).toContain("current 1.0.1, previous 1.0.0");
  expect(existsSync(join(builds, "1.0.0/.release"))).toBe(true);
  expect(unit()).not.toContain(repo);

  // a Lineclear worktree beside the release: nothing installed points into it, and a planted pi setting that does fails doctor
  const worktree = join(root, "worktree");
  mkdirSync(join(worktree, "pi"), { recursive: true });
  writeFileSync(join(worktree, ".git"), "gitdir: /nowhere\n");
  expect(doctor().out).toContain("ok     installed paths");
  const settings = join(home2, ".pi/agent/settings.json");
  mkdirSync(join(home2, ".pi/agent"), { recursive: true });
  writeFileSync(settings, JSON.stringify({ extensions: [join(worktree, "pi/extension.ts")] }));
  const planted = doctor();
  expect(planted.code).toBe(1);
  expect(planted.out).toContain(`FAILED installed paths: ${settings} points into ${worktree}`);
  rmSync(settings);

  // a link to a git checkout is not a release: doctor fails and names the install
  const checkout = join(root, "checkout");
  mkdirSync(join(checkout, "bin"), { recursive: true });
  mkdirSync(join(checkout, ".git"), { recursive: true });
  writeFileSync(join(checkout, "bin/lineclear"), "#!/bin/sh\n");
  const onCheckout = { ...releaseEnv("v1.0.1"), PATH: `${join(checkout, "bin")}:${process.env.PATH}` };
  const bad = sh([join(builds, "current/bin/lineclear"), "doctor"], { env: onCheckout });
  expect(bad.code).toBe(1);
  expect(bad.out).toMatch(/FAILED stable build: .*lineclear on PATH/);
  expect(bad.out).toContain("LINECLEAR_REF=v");
}, 240_000);
