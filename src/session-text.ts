// What is read from pi's session files: tokens, turns, token pack parts and roadmap reads.

export interface Usage {
  model: string;
  provider: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** "reviewer" for a call of a reviewer's session; the agent's own calls carry none. */
  role?: "reviewer";
  /** Which review of the task the call belongs to, from 1. Only with a role. */
  round?: number;
}

/** The round of a reviewer's pi session when its first user message names the `<task>/Reviewer` chat identity: the `review round N` line, else 0. Undefined for any other session. */
export function reviewerRound(text: string): number | undefined {
  for (const line of text.split("\n")) {
    if (!line.includes('"role":"user"')) continue;
    try {
      const m = JSON.parse(line)?.message;
      if (m?.role !== "user") continue;
      const c = m.content;
      const body = typeof c === "string" ? c : (c ?? []).map((x: { text?: string } | null) => x?.text ?? "").join("");
      if (!/LINECLEAR_CHAT="?[\w.-]+\/Reviewer\b/.test(body)) return undefined;
      return Number(/review round (\d+)/i.exec(body)?.[1] ?? 0);
    } catch {
      // a half-written line is not the first message
    }
  }
  return undefined;
}

/** The assistant messages of one pi session file, with their tokens. */
export function sessionUsage(text: string): Usage[] {
  const out: Usage[] = [];
  for (const line of text.split("\n")) {
    if (!line.includes('"usage"')) continue;
    try {
      const m = JSON.parse(line)?.message;
      if (m?.role !== "assistant" || !m.usage) continue;
      out.push({
        model: String(m.model ?? ""),
        provider: String(m.provider ?? ""),
        input: m.usage.input ?? 0,
        output: m.usage.output ?? 0,
        cacheRead: m.usage.cacheRead ?? 0,
        cacheWrite: m.usage.cacheWrite ?? 0,
      });
    } catch {
      // a half-written last line counts nothing
    }
  }
  return out;
}

/**
 * The times of the model turns in one pi session file that nothing asked for: a user message that is not the brief
 * (the first), not an owner message, not a step's own line (`<lineclear><go>`), not a rule's resume or answer
 * (`[lineclear:resume]`, `[lineclear:answer]`). What counts is a `[lineclear]` line with no kind, and a Lineclear
 * line with a tag other than `go` (news, health, heartbeat, github, queue). The owner's lines have no mark. Goal: none.
 */
export function turnTimes(text: string): number[] {
  const out: number[] = [];
  let first = true;
  for (const line of text.split("\n")) {
    if (!line.includes('"role":"user"')) continue;
    try {
      const e = JSON.parse(line);
      if (e?.message?.role !== "user") continue;
      if (first) {
        first = false;
        continue;
      }
      const c = e.message.content;
      const body = (typeof c === "string" ? c : (c ?? []).map((x: { text?: string } | null) => x?.text ?? "").join("")).trimStart();
      const lineclear = /^<lineclear>\s*<([a-z][\w-]*)/.exec(body)?.[1];
      const counted = /^\[lineclear\]/.test(body) || (lineclear !== undefined && lineclear !== "go");
      const at = new Date(e.timestamp).getTime();
      if (counted && !Number.isNaN(at)) out.push(at);
    } catch {
      // a half-written last line counts nothing
    }
  }
  return out;
}

/** The token pack's parts a session recorded as on (its last record), or none when it recorded nothing. */
export function sessionParts(text: string): string[] {
  let on: string[] = [];
  for (const line of text.split("\n")) {
    if (!line.includes('"lineclear-pack"')) continue;
    try {
      const e = JSON.parse(line);
      if (e?.customType === "lineclear-pack" && Array.isArray(e.data?.on)) on = e.data.on.filter((x: unknown) => typeof x === "string");
    } catch {
      // a half-written last line counts nothing
    }
  }
  return on;
}

/** The brief of a session: the text of its first user message. */
function firstUserText(text: string): string {
  for (const line of text.split("\n")) {
    if (!line.includes('"role":"user"')) continue;
    try {
      const e = JSON.parse(line);
      if (e?.message?.role !== "user") continue;
      const c = e.message.content;
      return typeof c === "string" ? c : (c ?? []).map((x: { text?: string } | null) => x?.text ?? "").join("");
    } catch {
      // a half-written line counts nothing
    }
  }
  return "";
}

/**
 * What one pi session did with the roadmap: `small` when its brief sends the worker to `lineclear roadmap show`, and
 * `whole` when it read all of docs/ROADMAP.md (a `read` of it with no offset or limit, or a `cat` of it).
 */
export function roadmapUse(text: string): { small: boolean; whole: boolean } {
  const small = firstUserText(text).includes("lineclear roadmap show");
  let whole = false;
  for (const line of text.split("\n")) {
    if (whole || !line.includes("ROADMAP.md") || !line.includes('"toolCall"')) continue;
    try {
      const e = JSON.parse(line);
      for (const c of e?.message?.content ?? []) {
        if (c?.type !== "toolCall") continue;
        const a = c.arguments ?? {};
        if (c.name === "read" && /ROADMAP\.md$/.test(String(a.path ?? "")) && a.offset === undefined && a.limit === undefined) whole = true;
        if (c.name === "bash" && /(^|[\s;&|])cat\s+[^;&|\n]*ROADMAP\.md/.test(String(a.command ?? ""))) whole = true;
      }
    } catch {
      // a half-written last line counts nothing
    }
  }
  return { small, whole };
}

/** Sessions that read the whole roadmap, split by whether their brief was the small one (after) or not (before). */
export interface RoadmapReads {
  before: { sessions: number; whole: number };
  after: { sessions: number; whole: number };
}

export function roadmapReads(texts: string[]): RoadmapReads {
  const out: RoadmapReads = { before: { sessions: 0, whole: 0 }, after: { sessions: 0, whole: 0 } };
  for (const t of texts) {
    if (!firstUserText(t).includes("Build step ")) continue; // a reviewer's or a planner's session is not a worker's
    const u = roadmapUse(t);
    const side = u.small ? out.after : out.before;
    side.sessions++;
    if (u.whole) side.whole++;
  }
  return out;
}
