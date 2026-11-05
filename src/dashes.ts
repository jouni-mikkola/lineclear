export interface DashHit {
  file: string;
  line: number;
  char: "en dash" | "em dash";
}

const NAMES: Record<string, DashHit["char"]> = {
  "\u2013": "en dash",
  "\u2014": "em dash",
};

/** Finds every en dash and em dash in a text, with its 1-based line. */
export function findDashes(file: string, text: string): DashHit[] {
  const hits: DashHit[] = [];
  text.split("\n").forEach((line, i) => {
    for (const ch of line) {
      const char = NAMES[ch];
      if (char) hits.push({ file, line: i + 1, char });
    }
  });
  return hits;
}
