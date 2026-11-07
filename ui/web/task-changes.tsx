import { useEffect, useState } from "react";
import type { TaskChanges } from "../../src/task-changes.ts";
import { DiffFile, PullRequest } from "../kit/diff.tsx";
import { Part, type PartState } from "../kit/index.ts";
import { get, sampleState } from "./data.ts";
import type { PageState } from "./states.ts";

// A task's changes, the tab next to its terminal: the branch's diff against its base and its pull request, read only.
// `?state=` draws sample states instead.

const SHOWN = 40;

const hunk = (i: number) => [
  `@@ -${i * 10},4 +${i * 10},6 @@ export function total(cart: Cart) {`,
  " const lines = cart.lines;",
  "-  return lines.reduce((s, l) => s + l.price, 0);",
  "+  const sum = lines.reduce((s, l) => s + l.price * l.qty, 0);",
  "+  return Math.round(sum * 100) / 100;",
  " }",
];

const sampleFile = (i: number, path = `src/cart/total-${i}.ts`) => ({ path, added: 2, removed: 1, lines: hunk(i), cut: 0 });

const sampleChanges = (s: PageState): TaskChanges | { error: string } | undefined => {
  if (s === "loading") return undefined;
  if (s === "error" || s === "offline") return { error: "This task has no worktree on this machine." };
  if (s === "empty") return { base: "main", files: [], more: 0 };
  const pr = { number: 52, url: "https://github.com/example/shop/pull/52", state: "OPEN", title: "WEB-3 Totals follow the removed line" };
  if (s === "long") {
    const long = `src/${"deeply/nested/".repeat(6)}the-quarterly-numbers-for-every-shop-split-by-region.ts`;
    return {
      base: "main",
      pr,
      files: [{ ...sampleFile(1, long), lines: [...hunk(1), `+  const note = "${"a very long line of text ".repeat(14)}";`], cut: 120 }, sampleFile(2)],
      more: 0,
    };
  }
  if (s === "many") return { base: "main", pr, files: Array.from({ length: 80 }, (_, i) => sampleFile(i + 1)), more: 12 };
  return { base: "main", pr, files: [sampleFile(1), sampleFile(2), { path: "docs/cart.png", added: 0, removed: 0, lines: [], cut: 0, binary: true }], more: 0 };
};

export function ChangesTab({ id }: { id: string }) {
  const sample = sampleState();
  const [read, setRead] = useState<TaskChanges | { error: string } | undefined>(() => (sample ? sampleChanges(sample) : undefined));
  const [more, setMore] = useState(false);
  useEffect(() => {
    if (sample) return;
    let live = true;
    const load = () =>
      get<TaskChanges>(`/api/task/${encodeURIComponent(id)}/changes`, (d) => Array.isArray((d as TaskChanges)?.files)).then(
        (d) => live && setRead(d),
        (e) => live && setRead({ error: String(e?.message ?? e) }),
      );
    void load();
    const t = setInterval(load, 10_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [id, sample]);
  const data = read && !("error" in read) ? read : undefined;
  const state: PartState = !read ? "loading" : "error" in read ? "error" : data?.files.length ? "filled" : "empty";
  const files = data?.files ?? [];
  const shown = more ? files : files.slice(0, SHOWN);
  return (
    <div data-changes={state}>
      <Part
        state={state}
        label="The changes"
        empty={{ text: "This branch has no change against its base yet." }}
        error={read && "error" in read ? read.error : undefined}
        rows={4}
      >
        <div className="space-y-3">
          {data?.pr && <PullRequest pr={data.pr} />}
          <p className="text-sm text-fg3">
            {files.length + (data?.more ?? 0)} files against {data?.base}
          </p>
          <ul className="space-y-2">
            {shown.map((f, i) => (
              <li key={f.path}>
                <DiffFile f={f} open={i === 0} />
              </li>
            ))}
          </ul>
          {files.length > shown.length && (
            <button type="button" onClick={() => setMore(true)} className="text-sm text-fg3 hover:text-fg">
              {files.length - shown.length} more
            </button>
          )}
          {data && data.more > 0 && <p className="text-sm text-fg3">{data.more} more files are in the branch.</p>}
        </div>
      </Part>
    </div>
  );
}
