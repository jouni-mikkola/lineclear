// Part of the token pack: a tool result over a set size is cut to its start and its end. The whole result, secrets
// removed, is saved in the task's temporary folder and the cut result says how to read the rest. Test output keeps its
// failures and its summary. Writes, edits, images and the chat with the owner are never cut. Imports nothing of Lineclear.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** A parsed file or event read as it is: its shape is not ours to promise. */
type Raw = any;

type Env = Record<string, string | undefined>;
type Pi = { on: (event: string, handler: (event: Raw, ctx: Raw) => unknown) => void };

export const CAP = 20_000; // characters a result may have
export const TEST_MIN = 4_000; // test output from this size is compacted
export const TEST_TAIL = 40; // last lines of test output kept
const HEAD = 0.6;
const TAIL = 0.3;
const MAX_SAVE = 64 * 1024 * 1024; // a result longer than this is left whole: the file must hold all of it

/** Tools whose results are never cut. */
export const NEVER = new Set(["write", "edit"]);
const CHAT = /^\s*(?:\S*\/)?lineclear\s+(?:chat|ask|reply|say|wait|resume)\b/;
const TEST =
  /(?:^|[\s;&|(])(?:bun\s+(?:run\s+)?(?:test|check)|(?:pnpm|npm|yarn)\s+(?:run\s+)?(?:test|check)|npx\s+(?:vitest|jest)|vitest|jest|pytest|cargo\s+test|go\s+test|make\s+(?:test|check)|lineclear\s+check)\b/;
const SUMMARY =
  /^\s*(?:=+ .*\b(?:passed|failed|errors?)\b|Ran \d+ tests?|\d+ (?:pass|fail)\b|Tests?:?\s+\d|Test Files\s|test result:|(?:OK|FAILED)\b|ok\s+\S+\s+[\d.]+s|# (?:pass|fail|tests)\b)/;
const FAILED = /(?:\bfail(?:ed|ure|ures)?\b|\berror\b|\(fail\)|✗|✘|✖|^not ok\b|^FAIL\b|\bpanic\b|AssertionError|Traceback)/i;

// ---- secrets ----

const SECRET_ENV = /(TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|API_?KEY|PRIVATE_?KEY|CREDENTIAL|ACCESS_?KEY)/i;
const NOT_SECRET_ENV = /(_SOCK|_SOCKET|_FILE|_PATH|_DIR|_URL|_ENDPOINT|_TTL|_TIMEOUT)$/i;
const SHAPES: [RegExp, string | ((m: string, ...g: string[]) => string)][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[secret removed]"],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, "[secret removed]"],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g, "[secret removed]"],
  [/\bglpat-[A-Za-z0-9_-]{16,}/g, "[secret removed]"],
  [/\bnpm_[A-Za-z0-9]{30,}/g, "[secret removed]"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "[secret removed]"],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "[secret removed]"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, "[secret removed]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[secret removed]"],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{20,}/g, (_m, scheme) => `${scheme} [secret removed]`],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]{3,}@/gi, (_m, head) => `${head}[secret removed]@`],
  [/\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_?KEY)[A-Z0-9_]*)=(\S{6,})/g, (_m, name) => `${name}=[secret removed]`],
];

/** `text` with secret shapes and the values of this process's secret-looking variables removed. */
export function removeSecrets(text: string, env: Env = process.env): string {
  const values = Object.entries(env)
    .filter(([k, v]) => SECRET_ENV.test(k) && !NOT_SECRET_ENV.test(k) && typeof v === "string" && v.length >= 8)
    .map(([, v]) => v as string)
    .sort((a, b) => b.length - a.length);
  for (const v of values) text = text.split(v).join("[secret removed]");
  for (const [re, to] of SHAPES) text = text.replace(re, to as Raw);
  return text;
}

// ---- the cut ----

const lines = (s: string) => (s.match(/\n/g)?.length ?? 0) + (s.endsWith("\n") ? 0 : 1);

/** Where to cut: the start and the end kept, cut at line breaks. Null when the text fits. */
export function plan(text: string, cap = CAP) {
  if (text.length <= cap) return null;
  let headEnd = Math.floor(cap * HEAD);
  const nl = text.lastIndexOf("\n", headEnd - 1);
  if (nl + 1 >= headEnd * 0.75) headEnd = nl + 1;
  else if (/[\ud800-\udbff]/.test(text[headEnd - 1]!)) headEnd -= 1;
  let tailStart = text.length - Math.floor(cap * TAIL);
  if (text[tailStart - 1] !== "\n") {
    const nl2 = text.indexOf("\n", tailStart);
    if (nl2 !== -1 && nl2 + 1 - tailStart <= cap * TAIL * 0.25) tailStart = nl2 + 1;
    else if (/[\udc00-\udfff]/.test(text[tailStart]!)) tailStart += 1;
  }
  if (tailStart <= headEnd) return null;
  const from = lines(text.slice(0, headEnd).replace(/\n$/, "")) + (text[headEnd - 1] === "\n" ? 1 : 0);
  return { headEnd, tailStart, total: text.length, totalLines: lines(text), from, to: Math.max(from, lines(text.slice(0, tailStart))) };
}

export function cut(text: string, p: NonNullable<ReturnType<typeof plan>>, file: string): string {
  const note =
    `[Output cut by the token pack: ${p.total} characters in ${p.totalLines} lines; the middle ${p.tailStart - p.headEnd} characters ` +
    `(lines ${p.from}-${p.to}) are left out. The whole result, secrets removed, is in ${file}. ` +
    `Read the part you need: read ${file} with offset=${p.from} limit=200, or grep -n on it. Do not run the command again just to see the rest.]`;
  return `${text.slice(0, p.headEnd)}\n${note}\n${text.slice(p.tailStart)}`;
}

/** Test output: the summary lines and the failed lines of the omitted part, then the last lines. Null when it saves nothing. */
export function compactTests(text: string, file: string): string | null {
  const all = text.split("\n");
  if (all[all.length - 1] === "") all.pop();
  const tailFrom = all.length - TEST_TAIL;
  if (tailFrom <= 0) return null;
  const clip = (s: string) => (s.length > 400 ? `${s.slice(0, 400)} …` : s);
  const summary: string[] = [];
  const failed: string[] = [];
  all.slice(0, tailFrom).forEach((l, i) => {
    if (SUMMARY.test(l)) summary.push(`${i + 1}: ${clip(l)}`);
    else if (FAILED.test(l)) failed.push(`${i + 1}: ${clip(l)}`);
  });
  const out = [
    `[Test output compacted by the token pack: ${text.length} characters in ${all.length} lines. Shown: the summary lines and ${failed.length} failed lines of the omitted part, ` +
      `and the last ${TEST_TAIL} lines (from line ${tailFrom + 1}). The whole output, secrets removed, is in ${file}. ` +
      `Read the rest: read ${file} with offset=<line> limit=200, or grep -n on it. Do not run the command again just to see more.]`,
  ];
  if (summary.length) out.push("[summary]", ...summary);
  if (failed.length) out.push("[failed lines of the omitted part, with their line numbers]", ...failed);
  out.push(`[last ${TEST_TAIL} lines]`, ...all.slice(tailFrom).map(clip));
  const result = out.join("\n");
  return result.length < text.length ? result : null;
}

// ---- the part ----

/** Where the cut results are saved: the task's folder in the temporary folder. */
export function saveDir(env: Env = process.env): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : "x";
  const task = (env.LINECLEAR_CHAT ?? "").split("/")[0]!.replace(/[^A-Za-z0-9_.-]/g, "_") || "session";
  return join(env.TMPDIR || tmpdir(), `lineclear-cut-${uid}`, task);
}

/** The log of cuts and reads, for the numbers. */
export function logFile(env: Env = process.env): string {
  return join(env.LINECLEAR_STATE || join(env.HOME ?? homedir(), ".local", "state", "lineclear"), "pack", "cut-output.jsonl");
}

/**
 * Cut results, the characters they saved and the share read again, from the log's lines. A cut read through its saved
 * file is the cut working as told; one whose command ran again (`rerun`) is the waste the rule must keep under 15 %.
 */
export function cutStats(logLines: string[]) {
  let cuts = 0,
    saved = 0;
  const ids = new Set<string>(),
    again = new Set<string>(),
    reran = new Set<string>();
  for (const l of logLines) {
    let e: Raw;
    try {
      e = JSON.parse(l);
    } catch {
      continue;
    }
    if (e?.ev === "cut") {
      cuts++;
      saved += Number(e.saved) || 0;
      ids.add(`${e.session}:${e.id}`);
    } else if (e?.ev === "read-again") {
      again.add(`${e.session}:${e.id}`);
      if (e.how === "rerun") reran.add(`${e.session}:${e.id}`);
    }
  }
  const reread = [...again].filter((i) => ids.has(i)).length;
  const rerun = [...reran].filter((i) => ids.has(i)).length;
  return { cuts, saved, reread, share: cuts ? reread / cuts : 0, rerun, rerunShare: cuts ? rerun / cuts : 0 };
}

const textOf = (blocks: Raw[]) =>
  blocks
    .filter((b) => b?.type === "text")
    .map((b) => String(b.text ?? ""))
    .join("\n");

export default function cutOutput(pi: Pi, env: Env = process.env): void {
  const dir = saveDir(env);
  const log = (ev: object) => {
    try {
      const f = logFile(env);
      mkdirSync(join(f, ".."), { recursive: true });
      appendFileSync(f, `${JSON.stringify({ t: new Date().toISOString(), ...ev })}\n`);
    } catch {
      // the log is a courtesy
    }
  };
  let seq = 0;
  const files = new Map<string, number>(); // saved file -> id of the cut
  const sources = new Map<string, number>(); // what a result came from -> id of the cut
  const again = new Set<string>(); // cut id and how it was read again, each once
  const session = (ctx: Raw) => {
    try {
      return String(ctx?.sessionManager?.getSessionId?.() ?? "") || `p${process.pid}`;
    } catch {
      return `p${process.pid}`;
    }
  };
  const key = (tool: string, input: Raw, cwd?: string) =>
    tool === "read" && typeof input?.path === "string" ? `read:${resolve(cwd ?? "", input.path)}` : `${tool}:${JSON.stringify(input ?? {})}`;

  // a later call for a file we saved, or for the same source, is a cut result read again
  pi.on("tool_call", (ev, ctx) => {
    try {
      const s = JSON.stringify(ev.input ?? {});
      let id: number | undefined;
      for (const [f, i] of files) if (s.includes(f)) id = i;
      const how = id === undefined ? "rerun" : "file";
      id ??= sources.get(key(String(ev.toolName), ev.input, ctx?.cwd));
      const seen = `${id}:${how}`;
      if (id !== undefined && !again.has(seen)) {
        again.add(seen);
        log({ ev: "read-again", session: session(ctx), id, how });
      }
    } catch {
      // counting must never get in the way of a call
    }
    return undefined;
  });

  /** The text of a result worth cutting, with whether it is a test run; undefined when it is left alone. */
  const worthCutting = (tool: string, ev: Raw, blocks: Raw[]) => {
    if (NEVER.has(tool) || blocks.some((b) => b?.type === "image")) return undefined;
    const command = typeof ev.input?.command === "string" ? ev.input.command : "";
    if (tool === "bash" && CHAT.test(command)) return undefined; // the chat with the owner
    const raw = textOf(blocks);
    const tests = tool === "bash" && TEST.test(command) && raw.length > TEST_MIN;
    if ((raw.length <= CAP && !tests) || raw.length > MAX_SAVE) return undefined;
    if (JSON.stringify(ev.input ?? {}).includes(dir)) return undefined; // reading our own file back
    return { raw, tests };
  };

  pi.on("tool_result", (ev, ctx) => {
    try {
      const tool = String(ev.toolName);
      const blocks: Raw[] = Array.isArray(ev.content) ? ev.content : [];
      const found = worthCutting(tool, ev, blocks);
      if (!found) return undefined;
      const { raw, tests } = found;
      const clean = removeSecrets(raw, env); // before anything is saved or sent
      const p = plan(clean);
      const id = ++seq;
      const file = join(dir, `${String(id).padStart(4, "0")}-${tool.replace(/[^A-Za-z0-9_-]/g, "_")}.txt`);
      const text = (tests ? compactTests(clean, file) : null) ?? (p ? cut(clean, p, file) : null);
      if (text === null) return undefined;
      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        writeFileSync(file, clean, { mode: 0o600 });
      } catch {
        return undefined; // no file, no cut
      }
      files.set(file, id);
      sources.set(key(tool, ev.input, ctx?.cwd), id);
      log({ ev: "cut", session: session(ctx), id, tool, chars: raw.length, saved: raw.length - text.length });
      return { content: [{ type: "text", text }] };
    } catch {
      return undefined; // the whole result is better than a broken cut
    }
  });
}
