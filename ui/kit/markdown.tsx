import { Fragment, memo, type ReactNode } from "react";

// The Dispatcher's answers as markdown: paragraphs, headings, lists, code, quotes, tables, links and images. It
// builds React elements and never HTML from the text, so nothing in an answer runs on the page. A link opens only
// to the web or mail, and only on a click. An image shows by its full path on this machine through the server, which
// reads it only from the Dispatcher's own folders, or from inside the text: never from the web, where loading it
// would send what its address holds to another site with no click.

const IMAGE_PATH = /^\/\S+\.(png|jpe?g|gif|webp)$/i;

/** Where the page reads an image an answer names, or undefined when it cannot show it. */
export function imageSrc(src: string): string | undefined {
  // a picture inside the text itself; an image element never runs what it holds
  if (/^data:image\/(png|jpeg|gif|webp|svg\+xml)[;,]/i.test(src)) return src;
  if (src.startsWith("/api/chat/")) return src;
  if (IMAGE_PATH.test(src)) return `/api/chat/image?path=${encodeURIComponent(src)}`;
  return undefined;
}

const safeHref = (href: string) => (/^(https?:|mailto:)/i.test(href) ? href : undefined);

type Open = (src: string, alt: string) => void;

const LINK = "text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent";
const Web = ({ href, cls = "", children }: { href: string; cls?: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" data-inline className={`${LINK} ${cls}`}>
    {children}
  </a>
);

function Img({ src, alt, onOpen }: { src: string; alt: string; onOpen?: Open }) {
  const url = imageSrc(src);
  if (!url) {
    // a web image is a link to it
    const href = safeHref(src);
    return href ? <Web href={href}>{alt || src}</Web> : <span className="text-fg3">{alt || src}</span>;
  }
  const img = <img src={url} alt={alt} loading="lazy" className="max-h-72 max-w-full rounded-sm border border-line object-contain" />;
  return onOpen ? (
    <button
      type="button"
      onClick={() => onOpen(url, alt)}
      className="my-1 block max-w-full cursor-zoom-in rounded-sm focus-visible:outline-2 focus-visible:outline-accent"
      aria-label={`Open ${alt || "the image"} large`}
    >
      {img}
    </button>
  ) : (
    img
  );
}

const INLINE: [RegExp, (m: RegExpExecArray, key: number, open?: Open) => ReactNode][] = [
  [
    /`([^`\n]+)`/,
    (m, k) => (
      <code key={k} className="rounded-[4px] bg-raised3 px-1 py-px font-mono text-sm text-fg">
        {m[1]}
      </code>
    ),
  ],
  [/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/, (m, k, open) => <Img key={k} src={m[2]!} alt={m[1]!} onOpen={open} />],
  [
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/,
    (m, k, open) => {
      const href = safeHref(m[2]!);
      return href ? (
        <Web key={k} href={href}>
          {inline(m[1]!, open)}
        </Web>
      ) : (
        <Fragment key={k}>{inline(m[1]!, open)}</Fragment>
      );
    },
  ],
  [
    /<?(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])>?/,
    (m, k) => (
      <Web key={k} href={m[1]!} cls="break-all">
        {m[1]}
      </Web>
    ),
  ],
  [
    /\*\*([^*\n]+?)\*\*|__([^_\n]+?)__/,
    (m, k, open) => (
      <strong key={k} className="font-semibold text-fg">
        {inline(m[1] ?? m[2]!, open)}
      </strong>
    ),
  ],
  [/~~([^~\n]+?)~~/, (m, k, open) => <s key={k}>{inline(m[1]!, open)}</s>],
  [/(?<![\w*])\*([^*\s][^*\n]*?)\*(?!\w)|(?<!\w)_([^_\s][^_\n]*?)_(?!\w)/, (m, k, open) => <em key={k}>{inline(m[1] ?? m[2]!, open)}</em>],
];

/** One line's inline marks, the earliest first. */
function inline(text: string, open?: Open): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest) {
    let best: { m: RegExpExecArray; make: (typeof INLINE)[number][1] } | undefined;
    for (const [re, make] of INLINE) {
      const m = re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { m, make };
    }
    if (!best) {
      out.push(rest);
      break;
    }
    if (best.m.index > 0) out.push(rest.slice(0, best.m.index));
    out.push(best.make(best.m, key++, open));
    rest = rest.slice(best.m.index + best.m[0].length);
  }
  return out;
}

const LIST = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));

/** Text with its lines kept: a single line break in an answer is a break, as in a chat. */
function Lines({ lines, open }: { lines: string[]; open?: Open }) {
  return (
    <>
      {lines.map((l, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {IMAGE_PATH.test(l.trim()) ? <Img src={l.trim()} alt={l.trim().split("/").pop()!} onOpen={open} /> : inline(l, open)}
        </Fragment>
      ))}
    </>
  );
}

const HRULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const FENCE = /^\s*(```|~~~)\s*([\w+-]*)/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const QUOTE = /^\s*>/;
const startsTable = (lines: string[], i: number) => (lines[i] ?? "").includes("|") && RULE.test(lines[i + 1] ?? "");

/** The lines from `i` while `keep` holds. */
function take(lines: string[], i: number, keep: (l: string) => boolean): string[] {
  let j = i;
  while (j < lines.length && keep(lines[j] ?? "")) j++;
  return lines.slice(i, j);
}

function Table({ head, rows, open }: { head: string[]; rows: string[][]; open?: Open }) {
  const row = (cs: string[], Cell: "th" | "td", cls: string) =>
    head.map((_, n) => (
      <Cell key={n} className={cls}>
        {inline(cs[n] ?? "", open)}
      </Cell>
    ));
  return (
    <div className="max-w-full overflow-x-auto rounded-sm border border-line">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="bg-raised2">{row(head, "th", "whitespace-nowrap px-3 py-2 font-medium text-fg")}</tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-t border-line">
              {row(r, "td", "px-3 py-2 align-top text-fg2")}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Item = { text: string[]; sub: string[] };

/** The items of one list from line `i`: an indented line under an item is a list inside it, or more of its text. */
function listItems(lines: string[], i: number, indent: number, ordered: boolean): Item[] {
  const items: Item[] = [];
  for (let j = i; j < lines.length; j++) {
    const line = lines[j] ?? "";
    const m = LIST.exec(line);
    const last = items.at(-1);
    if (m && (m[1] ?? "").length <= indent) {
      if (/\d/.test(m[2] ?? "") !== ordered) break;
      items.push({ text: [m[3] ?? ""], sub: [] });
    } else if (last && line.trim() && /^\s+/.test(line)) {
      if (LIST.test(line) || last.sub.length) last.sub.push(line.slice(Math.min(indent + 2, line.search(/\S/))));
      else last.text.push(line.trim());
    } else break;
  }
  return items;
}

/** The lines the items of a list take: its own, and the indented ones under them. */
const itemLines = (items: Item[]) => items.reduce((n, it) => n + it.text.length + it.sub.length, 0);

function blocks(lines: string[], open?: Open): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const key = out.length;
    const fence = FENCE.exec(line);
    const heading = HEADING.exec(line);
    const list = LIST.exec(line);
    if (!line.trim()) i++;
    else if (HRULE.test(line)) out.push(<hr key={key} className="border-line" />), i++;
    else if (fence) {
      const body = take(lines, i + 1, (l) => !l.trim().startsWith(fence[1] ?? ""));
      i += body.length + 2;
      out.push(
        <pre key={key} className="overflow-x-auto rounded-sm border border-line bg-base p-3 text-sm leading-5" tabIndex={0} data-lang={fence[2] || undefined}>
          <code className="font-mono text-fg">{body.join("\n")}</code>
        </pre>,
      );
    } else if (heading) {
      const Tag = (heading[1] ?? "").length <= 2 ? "h3" : "h4";
      out.push(
        <Tag key={key} className={`font-semibold text-fg ${Tag === "h3" ? "text-lg" : ""}`}>
          {inline(heading[2] ?? "", open)}
        </Tag>,
      );
      i++;
    } else if (startsTable(lines, i)) {
      const rows = take(lines, i + 2, (l) => l.includes("|") && !!l.trim());
      out.push(<Table key={key} head={cells(line)} rows={rows.map(cells)} open={open} />);
      i += 2 + rows.length;
    } else if (QUOTE.test(line)) {
      const body = take(lines, i, (l) => QUOTE.test(l));
      i += body.length;
      out.push(
        <blockquote key={key} className="space-y-2 border-l-2 border-line pl-3 text-fg2">
          {blocks(
            body.map((l) => l.replace(/^\s*>\s?/, "")),
            open,
          )}
        </blockquote>,
      );
    } else if (list) {
      const ordered = /\d/.test(list[2] ?? "");
      const items = listItems(lines, i, (list[1] ?? "").length, ordered);
      const start = ordered ? Number.parseInt(list[2] ?? "", 10) : undefined;
      const Tag = ordered ? "ol" : "ul";
      i += itemLines(items);
      out.push(
        <Tag key={key} start={start !== 1 ? start : undefined} className={`space-y-1 pl-5 ${ordered ? "list-decimal" : "list-disc"} marker:text-fg3`}>
          {items.map((it, n) => (
            <li key={n} className="pl-1">
              <Lines lines={it.text} open={open} />
              {it.sub.length > 0 && <div className="mt-1 space-y-1">{blocks(it.sub, open)}</div>}
            </li>
          ))}
        </Tag>,
      );
    } else {
      const para = take(lines, i, (l) => !!l.trim() && !/^\s*(```|~~~|#{1,6}\s|>)/.test(l));
      let n = 0;
      while (n < para.length && !(n > 0 && LIST.test(para[n] ?? "")) && !(n > 0 && startsTable(lines, i + n))) n++;
      out.push(
        <p key={key}>
          <Lines lines={para.slice(0, n)} open={open} />
        </p>,
      );
      i += Math.max(n, 1);
    }
  }
  return out;
}

/** Markdown as the page shows an answer. `onImage` opens an image large. */
export const Markdown = memo(function Markdown({ text, onImage }: { text: string; onImage?: Open }) {
  return (
    <div className="min-w-0 space-y-3 break-words text-fg" data-markdown>
      {blocks(text.replace(/\r\n?/g, "\n").split("\n"), onImage)}
    </div>
  );
});
