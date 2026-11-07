import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Runs git in a folder with a fixed author; throws git's error text. */
export const git = (cwd: string, ...a: string[]) => {
  const p = Bun.spawnSync(["git", ...a], {
    cwd,
    stdin: "ignore",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  });
  if (p.exitCode !== 0) throw new Error(p.stderr.toString());
};

/** A bare origin with one commit of these files on main, and a clone of it. */
export const originWithClone = (dir: string, files: Record<string, string>) => {
  const origin = join(dir, "origin.git");
  git(dir, "init", "-q", "--bare", "-b", "main", origin);
  const repo = join(dir, "repo");
  git(dir, "clone", "-q", origin, repo);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, name)), { recursive: true });
    writeFileSync(join(repo, name), text);
  }
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "start");
  git(repo, "push", "-q", "origin", "HEAD:main");
  return { origin, repo };
};

/** Writes an executable shell script, making its folders. */
export const script = (path: string, body: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
};
