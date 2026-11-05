// The `lineclear release promote` command and the Inbox items of a promotion (the rule loop's step is src/promote-step.ts).
import { resolve } from "node:path";
import { readMachines } from "./machine-list.ts";
import { addItem, type Item, readItems } from "./inbox.ts";
import { type Promotion, changesSince, promote, promotionRefusal } from "./promote.ts";

type Env = Record<string, string | undefined>;

/** The one item each promotion leaves: the version, what changed since stable and the smoke result, with one tap to go back. */
function postPromotion(p: Promotion, env: NodeJS.ProcessEnv = process.env): Item {
  const changes = changesSince(p.from, p.version, env);
  const lines = [
    p.failed
      ? `${p.version} was promoted and put back to ${p.from ?? "nothing"}: ${p.failed}`
      : `${p.version} is stable now${p.from ? `, it was ${p.from}` : ""}.`,
    ...(changes.length ? [`Changed since ${p.from}: ${changes.join("; ")}`] : []),
    `Smoke run: ${p.smoke}`,
  ];
  const base = { kind: "release" as const, task: "-", question: lines.join("\n"), since: new Date().toISOString() };
  if (p.failed) return addItem({ ...base, choices: ["Ok"], alert: "A promotion was rolled back" }, env);
  return addItem({ ...base, choices: ["Roll back"], release: { version: p.version, action: "rollback" }, alert: `${p.version} is stable` }, env);
}

/** A checked build waits for the owner's tap to become stable; one item per version. */
export function postPromoteAsk(version: string, env: NodeJS.ProcessEnv = process.env): Item | undefined {
  if (readItems(env).some((i) => i.release?.version === version && i.release.action === "promote")) return undefined;
  const question = `${version} passed its checks, smoke run and canary. Make it stable?`;
  return addItem(
    {
      kind: "release",
      task: "-",
      question,
      choices: ["Promote"],
      release: { version, action: "promote" },
      alert: `${version} waits to become stable`,
      since: new Date().toISOString(),
    },
    env,
  );
}

/** After a promotion that held, the other machines take the build one by one, in a process of their own: the update takes minutes. */
function updateOthers(env: Env): void {
  if (env.LINECLEAR_NO_FANOUT || readMachines(env).length === 0) return;
  // the command that runs this promotion: a release install has no checkout at the app path
  const cmd = [process.execPath, resolve(import.meta.dir, "..", "bin", "lineclear"), "machine", "update"];
  Bun.spawn(cmd, { env: env as Record<string, string>, stdio: ["ignore", "ignore", "ignore"], detached: true }).unref();
}

/** `lineclear release promote <version>`: the only path to stable. Leaves the Inbox item to read. */
export function promoteMain(argv: string[], out: (l: string) => void, env: Env = process.env): number {
  const ask = argv[0] === "--ask";
  const args = ask ? argv.slice(1) : argv;
  const [version] = args;
  if (args.length !== 1 || !/^\d+\.\d+\.\d+$/.test(version ?? "")) {
    out("usage: lineclear release promote [--ask] <version>");
    return 2;
  }
  if (ask) {
    const refused = promotionRefusal(version as string, env);
    if (!refused) postPromoteAsk(version as string, env);
    out(refused ? `lineclear release: ${refused}` : `${version} waits for the owner's tap to become stable`);
    return refused ? 1 : 0;
  }
  const p = promote(version as string, env);
  if (typeof p === "string") {
    out(`lineclear release: ${p}`);
    return 1;
  }
  postPromotion(p, env);
  if (!p.failed) updateOthers(env);
  out(p.failed ? `${p.version} did not hold, ${p.from ?? "nothing"} is back: ${p.failed}` : `${p.version} is stable now; ${p.smoke}`);
  return p.failed ? 1 : 0;
}
