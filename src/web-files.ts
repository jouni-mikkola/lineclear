import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";

/** Lineclear's web pages, built with Vite by `bun run web:build`. */
const WEB_ROOT = resolve(import.meta.dir, "..", "ui", "web");

/** Where `bun run web:build` puts the built pages. */
export const WEB_DIST = join(WEB_ROOT, "dist");

const COMPRESSED = new Set([".html", ".js", ".css", ".svg", ".json", ".map"]);
const gzipped = new Map<string, { time: number; body: Uint8Array }>();

/** The file gzipped as small as it goes, once: kept until it changes on disk. */
function gzipFile(file: string): Uint8Array {
  const time = statSync(file).mtimeMs;
  const kept = gzipped.get(file);
  if (kept && kept.time === time) return kept.body;
  const body = Bun.gzipSync(readFileSync(file), { level: 9 });
  gzipped.set(file, { time, body });
  return body;
}

/**
 * The answer to one request: a file in `dir`, or the app's index.html for a page path. A missing file with an
 * extension is a 404, and nothing outside `dir` is ever read. Text files go out gzipped when `acceptEncoding` allows.
 */
export function webResponse(dir: string, url: string, acceptEncoding = ""): Response {
  let path: string;
  try {
    path = decodeURIComponent(new URL(url, "http://x").pathname);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const root = realpathSync(dir);
  let file = resolve(root, `.${path}`);
  const inside = (f: string) => f === root || f.startsWith(root + sep);
  const headers: Record<string, string> = { "cache-control": path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache" };
  if (!(inside(file) && existsSync(file) && statSync(file).isFile() && inside(realpathSync(file)))) {
    if (extname(path)) return new Response("Not found", { status: 404 });
    file = join(root, "index.html");
    headers["cache-control"] = "no-cache";
  }
  const type = Bun.file(file).type;
  if (COMPRESSED.has(extname(file)) && /\bgzip\b/.test(acceptEncoding)) {
    return new Response(gzipFile(file) as BodyInit, { headers: { ...headers, "content-type": type, "content-encoding": "gzip", vary: "accept-encoding" } });
  }
  return new Response(Bun.file(file), { headers: { ...headers, "content-type": type, vary: "accept-encoding" } });
}
