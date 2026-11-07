// What is read from pi's session files: tokens and reviewer rounds.

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
      const entry = JSON.parse(line);
      const m = entry?.message;
      if (m?.role !== "user") continue;
      const c = m.content;
      const body = typeof c === "string" ? c : (c ?? []).map((x: { text?: string } | null) => x?.text ?? "").join("");
      if (!/^\s*LINECLEAR_CHAT="?[\w.-]+\/Reviewer\b/.test(body)) return undefined;
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
      const entry = JSON.parse(line);
      const m = entry?.message;
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
