// Search across the tasks, their last chat cards and the roadmap steps, for the page's search box. Plain text match,
// every word of the query in the text, no AI.
import type { HomeProject } from "./home-data.ts";
import type { RoadmapData } from "./roadmap-view.ts";

export interface SearchHit {
  kind: "task" | "chat" | "step";
  /** A task's id, or a step's id. */
  id: string;
  title: string;
  /** Where the words were found: a chat card's start, or a step's result. */
  text?: string;
  /** The project a step is of. */
  project?: string;
}

const MAX_HITS = 30;
const SNIPPET = 140;

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);
const has = (text: string | undefined, w: string[]) => {
  const t = (text ?? "").toLowerCase();
  return w.length > 0 && w.every((x) => t.includes(x));
};

/** Tasks first, then chats, then steps, each in the order given, at most 30 in all. */
export function search(q: string, projects: HomeProject[], roadmaps: RoadmapData[]): SearchHit[] {
  const w = words(q.slice(0, 200));
  const tasks = projects.flatMap((p) => p.tasks);
  const hits: SearchHit[] = [
    ...tasks.filter((t) => has(`${t.id} ${t.title}`, w)).map((t): SearchHit => ({ kind: "task", id: t.id, title: t.title })),
    ...tasks
      .filter((t) => has(t.last?.text, w))
      .map((t): SearchHit => ({ kind: "chat", id: t.id, title: t.title, text: (t.last?.text ?? "").slice(0, SNIPPET) })),
    ...roadmaps.flatMap((r) =>
      r.steps
        .filter((s) => has(`${s.id} ${s.title} ${s.result}`, w))
        .map((s): SearchHit => ({ kind: "step", id: s.id, title: s.title, text: s.result.slice(0, SNIPPET), project: r.project })),
    ),
  ];
  return hits.slice(0, MAX_HITS);
}

/** The hits for `q`: the roadmaps are read only when there is something to look for. */
export async function searchAnswer(
  q: string,
  projects: HomeProject[],
  projectNames: string[],
  roadmapOf: (name: string) => Promise<{ ok: RoadmapData } | { error: string } | undefined>,
): Promise<SearchHit[]> {
  if (!q.trim()) return [];
  const reads = await Promise.all([...new Set([...projectNames, ...projects.flatMap((p) => (p.roadmap ? [p.roadmap] : []))])].map(roadmapOf));
  return search(
    q,
    projects,
    reads.flatMap((r) => (r && "ok" in r ? [r.ok] : [])),
  );
}
