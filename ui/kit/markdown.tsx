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

function Img({ src, alt, onOpen }: { src: string; alt: string; onOpen?: Open }) {
  const url = imageSrc(src);
  if (!url) {
    // a web image is a link to it
    const href = safeHref(src);
    return href ? (
      <a href={href} target="_blank" rel="noopener noreferrer" data-inline className="text-accent underline underline-offset-2 hover:text-fg">
        {alt || src}
      </a>
    ) : (
      <span className="text-fg3">{alt || src}</span>
    );
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
      const inner = inline(m[1]!, open);
      return href ? (
        <a
          key={k}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          data-inline
          className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
        >
          {inner}
        </a>
      ) : (
        <Fragment key={k}>{inner}</Fragment>
      );
    },
  ],
  [
    /<?(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])>?/,
    (m, k) => (
      <a
        key={k}
        href={m[1]}
        target="_blank"
        rel="noopener noreferrer"
        data-inline
        className="break-all text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
      >
        {m[1]}
      </a>
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

/** What one block parser returns: the block and the index of the line after it. */
type Parsed = [ReactNode, number] | undefined;

const startsTable = (lines: string[], i: number) => (lines[i] ?? "").includes("|") && i + 1 < lines.length && RULE.test(lines[i + 1] ?? "");

function fenceBlock(lines: string[], i: number, k: number): Parsed {
  const fence = /^\s*(```|~~~)\s*([\w+-]*)/.exec(lines[i] ?? "");
  if (!fence) return undefined;
  const body: string[] = [];
  let j = i + 1;
  while (j < lines.length && !(lines[j] ?? "").trim().startsWith(fence[1] ?? "")) body.push(lines[j++] ?? "");
  return [
    <pre key={k} className="overflow-x-auto rounded-sm border border-line bg-base p-3 text-sm leading-5" data-lang={fence[2] || undefined}>
      <code className="font-mono text-fg">{body.join("\n")}</code>
    </pre>,
    j + 1,
  ];
}

function headingBlock(lines: string[], i: number, k: number, open?: Open): Parsed {
  const h = /^(#{1,6})\s+(.*)$/.exec(lines[i] ?? "");
  if (!h) return undefined;
  const text = inline(h[2] ?? "", open);
  return [
    (h[1] ?? "").length <= 2 ? (
      <h3 key={k} className="text-lg font-semibold text-fg">
        {text}
      </h3>
    ) : (
      <h4 key={k} className="font-semibold text-fg">
        {text}
      </h4>
    ),
    i + 1,
  ];
}

function tableBlock(lines: string[], i: number, k: number, open?: Open): Parsed {
  if (!startsTable(lines, i)) return undefined;
  const head = cells(lines[i] ?? "");
  const rows: string[][] = [];
  let j = i + 2;
  while (j < lines.length && (lines[j] ?? "").includes("|") && (lines[j] ?? "").trim()) rows.push(cells(lines[j++] ?? ""));
  return [
    <div key={k} className="max-w-full overflow-x-auto rounded-sm border border-line">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="bg-raised2">
            {head.map((c, n) => (
              <th key={n} className="whitespace-nowrap px-3 py-2 font-medium text-fg">
                {inline(c, open)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-t border-line">
              {head.map((_, n) => (
                <td key={n} className="px-3 py-2 align-top text-fg2">
                  {inline(r[n] ?? "", open)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>,
    j,
  ];
}

function quoteBlock(lines: string[], i: number, k: number, open?: Open): Parsed {
  if (!/^\s*>/.test(lines[i] ?? "")) return undefined;
  const body: string[] = [];
  let j = i;
  while (j < lines.length && /^\s*>/.test(lines[j] ?? "")) body.push((lines[j++] ?? "").replace(/^\s*>\s?/, ""));
  return [
    <blockquote key={k} className="space-y-2 border-l-2 border-line pl-3 text-fg2">
      {blocks(body, open)}
    </blockquote>,
    j,
  ];
}

type Item = { text: string[]; sub: string[] };

/** The items of one list from line `i`: an indented line under an item is a list inside it, or more of its text. */
function listItems(lines: string[], i: number, indent: number, ordered: boolean): { items: Item[]; end: number } {
  const items: Item[] = [];
  let j = i;
  while (j < lines.length) {
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
    j++;
  }
  return { items, end: j };
}

function listBlock(lines: string[], i: number, k: number, open?: Open): Parsed {
  const li = LIST.exec(lines[i] ?? "");
  if (!li) return undefined;
  const ordered = /\d/.test(li[2] ?? "");
  const { items, end } = listItems(lines, i, (li[1] ?? "").length, ordered);
  const start = ordered ? Number.parseInt(li[2] ?? "", 10) : undefined;
  const Tag = ordered ? "ol" : "ul";
  return [
    <Tag key={k} start={start !== 1 ? start : undefined} className={`space-y-1 pl-5 ${ordered ? "list-decimal" : "list-disc"} marker:text-fg3`}>
      {items.map((it, n) => (
        <li key={n} className="pl-1">
          <Lines lines={it.text} open={open} />
          {it.sub.length > 0 && <div className="mt-1 space-y-1">{blocks(it.sub, open)}</div>}
        </li>
      ))}
    </Tag>,
    end,
  ];
}

function paragraph(lines: string[], i: number, k: number, open?: Open): [ReactNode, number] {
  const para: string[] = [];
  let j = i;
  while (j < lines.length && (lines[j] ?? "").trim() && !/^\s*(```|~~~|#{1,6}\s|>)/.test(lines[j] ?? "") && !(para.length && LIST.test(lines[j] ?? ""))) {
    if (startsTable(lines, j)) break;
    para.push(lines[j++] ?? "");
  }
  return [
    <p key={k}>
      <Lines lines={para} open={open} />
    </p>,
    j,
  ];
}

function blocks(lines: string[], open?: Open): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const k = out.length;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push(<hr key={k} className="border-line" />);
      i++;
      continue;
    }
    const [node, next] =
      fenceBlock(lines, i, k) ??
      headingBlock(lines, i, k, open) ??
      tableBlock(lines, i, k, open) ??
      quoteBlock(lines, i, k, open) ??
      listBlock(lines, i, k, open) ??
      paragraph(lines, i, k, open);
    out.push(node);
    i = next;
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
