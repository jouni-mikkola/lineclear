import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Everything that talks to the `playwright-cli` command: the list of open sessions, one piece of code run in a
// session, and the code and reading of a picture.

export type Env = Record<string, string | undefined>;
export type Open = { name: string; cwd: string };

export const SESSION_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

/** Runs playwright-cli with a time limit and returns its output, or throws with its own words. */
async function run(env: Env, args: string[], cwd: string, ms = 15_000): Promise<string> {
  const p = Bun.spawn([env.LINECLEAR_PLAYWRIGHT_CLI ?? "playwright-cli", ...args], {
    cwd,
    env: env as Record<string, string>,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => p.kill("SIGKILL"), ms);
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  clearTimeout(timer);
  if (code !== 0) throw new Error((err || out).trim().split("\n")[0] || `playwright-cli failed (${code})`);
  return out;
}

/** The open sessions of every workspace, with the folder each one's commands must run in. */
async function openSessions(env: Env): Promise<Open[]> {
  const all = (JSON.parse(await run(env, ["list", "--all", "--json"], "/")).browsers ?? []) as { name?: unknown; workspace?: unknown; status?: unknown }[];
  return all
    .filter((b) => b.status === "open" && typeof b.name === "string" && SESSION_NAME.test(b.name))
    .map((b) => ({ name: b.name as string, cwd: typeof b.workspace === "string" && b.workspace.startsWith("/") ? b.workspace : "/" })); // a hash names a session opened outside any folder: it answers from the root
}

/** Runs at most `size` works at once; the rest wait in `waiting`, in order. */
export function limiter(size: number) {
  let busy = 0;
  const waiting: (() => void)[] = [];
  const slot = async <T>(work: () => Promise<T>): Promise<T> => {
    if (busy >= size) await new Promise<void>((r) => waiting.push(r));
    busy += 1;
    try {
      return await work();
    } finally {
      busy -= 1;
      waiting.shift()?.();
    }
  };
  return { slot, waiting };
}

/** The list of open sessions, kept and read again once it is older than `listLive`. The first list is read as soon as the server starts. */
export function sessionCache(env: Env, now: () => number, listLive: number) {
  let listed: { at: number; read: Promise<Open[]> } | undefined;
  let known: Open[] | undefined;
  const sessions = (age = listLive) => {
    if (!listed || now() - listed.at > age) {
      const read = openSessions(env);
      listed = { at: now(), read };
      // a failed read is not kept
      read.then(
        (v) => listed?.read === read && (known = v),
        () => listed?.read === read && (listed = undefined),
      );
    }
    return listed.read;
  };
  sessions().catch(() => {});
  return {
    /** The sessions as last read, at once; a read for the next ask starts in the background. Only the first waits. */
    async latest(age = listLive): Promise<Open[]> {
      const fresh = sessions(age);
      fresh.catch(() => {});
      return known ?? fresh;
    },
    find: async (name: string) => (await sessions()).find((s) => s.name === name),
    forget() {
      listed = undefined;
    },
  };
}

/** Runs one piece of playwright code in a session, from a file only this user can read, as it may hold typed text. */
export async function runInSession(env: Env, slot: <T>(work: () => Promise<T>) => Promise<T>, s: Open, code: string) {
  const dir = mkdtempSync(join(tmpdir(), "lineclear-browser-"));
  const file = join(dir, "code.js");
  writeFileSync(file, code, { mode: 0o600 });
  try {
    return await slot(() => run(env, [`-s=${s.name}`, "--raw", "run-code", `--filename=${file}`], s.cwd));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The playwright code of a picture. A thumbnail (480 pixels wide) is the screenshot drawn smaller in the page, as a
 * JPEG; if the page cannot do that, the screenshot itself is the answer.
 */
export const pictureCode = (thumb: boolean) =>
  `async page => { const shot = await page.screenshot({ type: "jpeg", quality: ${thumb ? 60 : 70}, scale: "css" }); let picture = shot.toString("base64");` +
  (thumb
    ? ` try { picture = await page.evaluate(async ([b64, w]) => { const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const bmp = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" })); if (bmp.width <= w) return b64; const c = new OffscreenCanvas(w, Math.round(bmp.height * w / bmp.width)); c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height); const out = new Uint8Array(await (await c.convertToBlob({ type: "image/jpeg", quality: 0.6 })).arrayBuffer()); let s = ""; for (let i = 0; i < out.length; i += 8192) s += String.fromCharCode(...out.subarray(i, i + 8192)); return btoa(s); }, [picture, 480]); } catch {}`
    : "") +
  ` return JSON.stringify({ url: page.url(), title: await page.title(), picture }); }`;

/** The JPEG and the page of what `pictureCode` printed. */
export function readShot(out: string) {
  let v: any = JSON.parse(out);
  if (typeof v === "string") v = JSON.parse(v);
  const jpeg = Buffer.from(typeof v?.picture === "string" ? v.picture : "", "base64");
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error("the picture is not a JPEG");
  return { jpeg, page: { title: String(v.title ?? ""), url: String(v.url ?? "") } };
}
