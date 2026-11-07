import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { installFixture } from "./install-fixture.ts";

type Fixture = Awaited<ReturnType<typeof installFixture>>;

/** The helpers of the update tests that install a broken version and look at what the rollback left. */
export function brokenInstalls({ home, repo, git, install }: Pick<Fixture, "home" | "repo" | "git" | "install">) {
  /** Commits a version that breaks the service the way BROKEN says, installs it, and puts the repository back. */
  function installBroken(how: string) {
    // the project p is Running before the update
    const dir = join(home, ".config/lineclear/projects/p");
    mkdirSync(dir, { recursive: true });
    const settings = join(dir, "settings.json");
    writeFileSync(settings, JSON.stringify({ repo, space: "p", check: "true", models: {} }));
    writeFileSync(join(repo, "BROKEN"), `${how}\n`);
    git("add", "-A");
    git("commit", "-q", "-m", `broken: ${how}`);
    const good = git("rev-parse", "HEAD~1").out.trim();
    const r = install();
    const after = JSON.parse(readFileSync(settings, "utf8"));
    rmSync(dir, { recursive: true });
    git("reset", "-q", "--hard", good);
    return { r, good, after };
  }
  // The Inbox items on disk (read here, not through src/inbox.ts: importing that module early changes other test files)
  const inbox = (): { kind: string; question: string }[] => {
    const dir = join(home, ".config/lineclear/inbox");
    return existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => f.endsWith(".json"))
          .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
          .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")))
      : [];
  };
  return { installBroken, inbox };
}
