import { lstatSync, readFileSync, readdirSync, readlinkSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { extensionFile, type Paths } from "./paths.ts";

export interface Remover {
  paths: Paths;
  /** Runs a command; a failure is ignored. */
  run(cmd: string[]): void;
}

export function realRemover(paths: Paths): Remover {
  return {
    paths,
    run(cmd) {
      try {
        Bun.spawnSync(cmd, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
      } catch {}
    },
  };
}

function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** The file install writes for pi, unchanged. */
function ourExtension(path: string, app: string): boolean {
  try {
    return readFileSync(path, "utf8") === extensionFile(app);
  } catch {
    return false;
  }
}

function ours(link: string, app: string): boolean {
  try {
    return lstatSync(link).isSymbolicLink() && readlinkSync(link).startsWith(`${app}/`);
  } catch {
    return false;
  }
}

const STORE_COPIES = "store-copies";

// the board's and herdr's units, which install.sh writes beside Lineclear's own
const BESIDE = ["lineclear-serve-7421.service", "lineclear-herdr.service"];

/** Removes what install added. Project settings and secrets stay unless `all`. */
export function uninstall(r: Remover, all: boolean, out: (line: string) => void): number {
  const { paths } = r;
  for (const unit of [paths.unit, ...BESIDE.map((name) => join(dirname(paths.unit), name))]) {
    if (!exists(unit)) continue;
    const name = unit.slice(dirname(unit).length + 1);
    r.run(["systemctl", "--user", "disable", "--now", name]);
    rmSync(unit, { force: true });
    r.run(["systemctl", "--user", "daemon-reload"]);
    out(`Removed the ${name} service`);
  }
  // the test track's timer and units (install_track in install.sh)
  const dir = dirname(paths.unit);
  const track = ["lineclear-track.timer", "lineclear-track.service", "lineclear-track-update.service"].filter((f) => exists(join(dir, f)));
  if (track.length > 0) {
    r.run(["systemctl", "--user", "disable", "--now", "lineclear-track.timer"]);
    for (const f of track) rmSync(join(dir, f), { force: true });
    r.run(["systemctl", "--user", "daemon-reload"]);
    out("Removed the test track's timer");
  }
  if (exists(paths.cacheEnv)) {
    rmSync(paths.cacheEnv, { force: true });
    r.run(["systemctl", "--user", "unset-environment", "NODE_COMPILE_CACHE"]);
    out("Removed the NODE_COMPILE_CACHE setting");
  }
  const files: [string, string, boolean][] = [
    [paths.extension, "the pi extension", true],
    [paths.binLink, "the lineclear command", true],
    [paths.app, "the Lineclear files", false],
  ];
  if (all) files.push([paths.config, "the project settings and secrets", false]);
  for (const [path, what, isLink] of files) {
    if (!exists(path)) continue;
    if (isLink && !ours(path, paths.app) && !(path === paths.extension && ourExtension(path, paths.app))) {
      out(`Left ${path}, it is not a link to Lineclear`);
      continue;
    }
    // the copies of the task store sit inside the app folder, and outlive it unless --all
    const keepCopies = path === paths.app && !all && exists(join(path, STORE_COPIES));
    if (keepCopies) {
      for (const e of readdirSync(path).filter((n) => n !== STORE_COPIES)) rmSync(join(path, e), { recursive: true, force: true });
    } else {
      rmSync(path, { recursive: true, force: true });
    }
    out(`Removed ${what}${keepCopies ? `, except ${join(path, STORE_COPIES)}` : ""}`);
  }
  if (!all && exists(paths.config)) out(`Kept the project settings and secrets in ${paths.config} (use --all to remove them)`);
  out("Done. git, Bun, herdr and pi stay, since other things may use them.");
  return 0;
}
