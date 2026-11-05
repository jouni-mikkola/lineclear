import { dirname, join, normalize } from "node:path";

// The screenshots of the app in docs/shots, taken by `bun run shots`, and the check that a picture of the app in the
// README or a docs page is one of them.

/** The widths of the pictures and the height of the window (a full page picture is taller). */
export const SHOT_WIDTHS = [
  [390, 844],
  [1440, 900],
] as const;

export const SHOT_VIEWS = [
  { name: "home", path: "/", title: "Home" },
  { name: "roadmap", path: "/web-shop/roadmap", title: "Roadmap of a project" },
  { name: "browsers", path: "/browsers", title: "Agent browsers" },
  { name: "chat", path: "/chat", title: "Chat" },
  { name: "usage", path: "/usage", title: "Usage" },
  { name: "settings", path: "/settings", title: "Settings" },
];

const TITLES = Object.fromEntries(SHOT_VIEWS.map((v) => [v.name, v.title]));

/** The list file: one line per picture, its file name in backticks first. */
export function shotsList(files: string[]): string {
  const lines = files.map((f) => {
    const [view = "", width = ""] = f.replace(/\.png$/, "").split("-");
    return `- \`${f}\`: ${TITLES[view] ?? view} at ${width} px`;
  });
  return `# Screenshots\n\nThe app's views on the demo data (\`lineclear run --demo\`), taken by \`bun run shots\`. Do not edit.\n\n${lines.join("\n")}\n`;
}

/** The picture file names a list names. */
export const shotsIn = (list: string): string[] => [...list.matchAll(/^- `([^`]+\.png)`/gm)].map((m) => m[1] ?? "");

/** Pictures that are not of the app: the mark, the illustrations and the brand directions. */
const NOT_THE_APP = ["docs/brand/", "docs/readme/", "ui/brand/"];
/** The brand directions are drawings of what Home could look like: each says so in its alt text. */
const DIRECTIONS = "docs/brand/home/";

/** The pictures a page embeds, as written: `![alt](src)` and `<img src="...">`. */
export function embeddedPictures(text: string): { src: string; alt: string }[] {
  const found = [...text.matchAll(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g)].map((m) => ({ src: m[2] ?? "", alt: m[1] ?? "" }));
  for (const m of text.matchAll(/<img\b[^>]*>/g)) {
    const src = /\bsrc="([^"]+)"/.exec(m[0])?.[1];
    if (src) found.push({ src, alt: /\balt="([^"]*)"/.exec(m[0])?.[1] ?? "" });
  }
  return found.filter((p) => !/^[a-z]+:/i.test(p.src));
}

/**
 * What is wrong with the pictures on one page (`file` is its path from the repo's root): a picture of the app that
 * is not in the list of screenshots, a screenshot in the list that is not taken, and a brand direction not captioned as one.
 */
export function strayPictures(file: string, text: string, listed: string[]): string[] {
  const problems: string[] = [];
  for (const { src, alt } of embeddedPictures(text)) {
    const path = normalize(join(dirname(file), src.split("#")[0] ?? src));
    if (path.startsWith(DIRECTIONS)) {
      if (!/^direction/i.test(alt)) problems.push(`${file}: ${src} is a brand direction: its alt text must start with "Direction"`);
    } else if (path.startsWith("docs/shots/")) {
      if (!listed.includes(path.slice("docs/shots/".length))) problems.push(`${file}: ${src} is not in docs/shots/list.md (run bun run shots)`);
    } else if (!NOT_THE_APP.some((p) => path.startsWith(p))) {
      problems.push(`${file}: ${src} is not a screenshot from docs/shots: a picture of the app must be one`);
    }
  }
  return problems;
}
