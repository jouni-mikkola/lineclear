import { readFileSync } from "node:fs";

export const html = readFileSync(new URL("../docs/design/board.html", import.meta.url), "utf8");
const script = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));

/** Builds the board's frames in a script on a stub page and returns what it put in each. */
export function frames(): Record<string, string> {
  const out: Record<string, string> = {};
  const stub = (id = ""): object => ({
    set innerHTML(v: string) {
      out[id] = v;
    },
    get innerHTML() {
      return out[id] ?? "";
    },
    querySelectorAll: () => [],
    addEventListener: () => {},
    clientWidth: 0,
    dataset: {},
    style: {},
  });
  const doc = { getElementById: (id: string) => stub(id), querySelectorAll: () => [] };
  new Function("document", "window", "addEventListener", "matchMedia", "performance", "requestAnimationFrame", script)(
    doc,
    {},
    () => {},
    () => ({ matches: true }),
    { now: () => 0 },
    () => 0,
  );
  return out;
}
