import { diff } from "./live-diff.ts";
import { gzipJson } from "./web-files.ts";

// The views' changes as they happen: `GET /api/live?v=<path>&r=<rev>&...` is a server-sent stream of what changed in
// each answer the page holds. A page that holds revision `r` of an answer gets one `patch` per change, a few bytes of
// operations (live-diff.ts), and a `full` answer only when its revision is not the current one. The server reads each
// watched answer once every `every` ms for all the pages together, and only while a page watches it.

/** The answers the pages read again and again. */
const LIVE_PATH = /^\/api\/(home|inbox|settings|events|plans|browsers|roadmap\/[^/]+|applied\/[^/]+)$/;

interface View {
  rev: number;
  text: string;
  value: unknown;
  watchers: Set<(patch: string) => void>;
}

export interface Answer {
  rev: number;
  text: string;
}

/** The server-sent frame of one change. */
const frame = (event: string, data: string) => `event: ${event}\ndata: ${data}\n\n`;

// Revisions count from the second the hub started, so a page that held one of a server before a restart is behind and
// gets the whole answer, never a patch for data it does not have.
export function liveHub(api: (req: Request) => Promise<Response>, first?: string, every = 6000, epoch = Math.floor(Date.now() / 1000)) {
  const views = new Map<string, View>();
  const reading = new Map<string, Promise<Answer | undefined>>();

  async function load(key: string): Promise<Answer | undefined> {
    const res = await api(new Request(`http://127.0.0.1${key}`));
    if (!res.ok) return undefined;
    const text = await res.text();
    const view = views.get(key);
    if (!view) {
      views.set(key, { rev: epoch + 1, text, value: JSON.parse(text), watchers: new Set() });
      return { rev: epoch + 1, text };
    }
    if (text !== view.text) {
      const value = JSON.parse(text);
      const ops = diff(view.value, value);
      view.text = text;
      view.value = value;
      if (ops.length > 0) {
        view.rev++;
        const patch = frame("patch", JSON.stringify({ path: key, rev: view.rev, ops }));
        for (const w of view.watchers) w(patch);
      }
    }
    return { rev: view.rev, text: view.text };
  }

  /** The answer now and its revision, one read for every page asking at the same time. */
  function read(key: string): Promise<Answer | undefined> {
    let p = reading.get(key);
    if (!p) {
      p = load(key).finally(() => reading.delete(key));
      reading.set(key, p);
    }
    return p;
  }

  /** The stream of the answers `wanted` (path to the revision the page holds). */
  function stream(wanted: Map<string, number>, signal: AbortSignal): Response {
    const enc = new TextEncoder();
    let stop = () => {};
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        const send = (s: string) => {
          try {
            c.enqueue(enc.encode(s));
          } catch {
            stop();
          }
        };
        const watching: View[] = [];
        const beat = setInterval(() => send(": beat\n\n"), 5000);
        const tick = setInterval(() => {
          for (const key of wanted.keys()) void read(key).catch(() => undefined);
        }, every);
        stop = () => {
          clearInterval(beat);
          clearInterval(tick);
          for (const v of watching) v.watchers.delete(send);
          try {
            c.close();
          } catch {
            // closed already
          }
        };
        signal.addEventListener("abort", () => stop());
        send("retry: 3000\n\n");
        for (const [key, rev] of wanted) {
          void read(key).then(
            (a) => {
              const view = views.get(key);
              if (!a || !view) return;
              view.watchers.add(send);
              watching.push(view);
              if (view.rev !== rev) send(frame("full", `{"path":${JSON.stringify(key)},"rev":${view.rev},"value":${view.text}}`));
            },
            () => undefined,
          );
        }
      },
      cancel() {
        stop();
      },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
  }

  /** Reads again every answer a page watches, now: a change on disk should not wait for the next beat. */
  function refresh() {
    for (const [key, view] of views) if (view.watchers.size > 0) void read(key).catch(() => undefined);
  }

  if (first) read(first).catch((e) => console.error(`lineclear: the first read failed: ${(e as Error).message}`));
  return { read, stream, refresh };
}

/** The paths and revisions a stream's query names, only those that are live answers. */
export function wantedViews(params: URLSearchParams): Map<string, number> {
  const paths = params.getAll("v");
  const revs = params.getAll("r");
  const wanted = new Map<string, number>();
  for (const [i, p] of paths.entries()) if (LIVE_PATH.test(p.split("?")[0] ?? "")) wanted.set(p, Number(revs[i]) || 0);
  return wanted;
}

/** The answer of an API request: the stream or a live answer with its revision (so the page can tell which changes of the stream are after it), else the plain answer, compressed. */
export async function apiAnswer(
  hub: ReturnType<typeof liveHub>,
  api: (req: Request) => Promise<Response>,
  req: Request,
  url: URL,
  known: boolean,
): Promise<Response> {
  const gzip = req.headers.get("accept-encoding") ?? "";
  if (req.method === "GET" && known) {
    if (url.pathname === "/api/live") return hub.stream(wantedViews(url.searchParams), req.signal);
    const read = LIVE_PATH.test(url.pathname) ? await hub.read(url.pathname + url.search).catch(() => undefined) : undefined;
    if (read) {
      const headers = { "content-type": "application/json", "cache-control": "no-store", "x-live-rev": String(read.rev) };
      return gzipJson(new Response(read.text, { headers }), gzip);
    }
  }
  return gzipJson(await api(req), gzip);
}
