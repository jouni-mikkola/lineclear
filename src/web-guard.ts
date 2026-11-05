import { randomUUID } from "node:crypto";

export type Env = Record<string, string | undefined>;
export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** Held by Lineclear's own pages only: set as a cookie when a page loads, and sent back in a header on each POST. */
export const PAGE_TOKEN = randomUUID();
export const TOKEN_COOKIE = "lineclear_token";
const TOKEN_HEADER = "x-lineclear-token";
/**
 * A POST must be JSON from this server's own pages: it carries the page token, and has no Origin or one whose name
 * and port equal the request's Host and whose name is known. The scheme may differ, as behind an HTTPS proxy that
 * ends TLS. A plain `curl` has no token, so an agent cannot answer.
 */
export const ownPage = (req: Request, url: URL, env: Env) => {
  if (!req.headers.get("content-type")?.startsWith("application/json")) return false;
  if (req.headers.get(TOKEN_HEADER) !== PAGE_TOKEN) return false;
  const origin = req.headers.get("origin");
  if (origin === null) return true;
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  if (o.protocol !== "http:" && o.protocol !== "https:") return false;
  const host = (req.headers.get("host") ?? url.host).toLowerCase();
  return o.host === host && knownHost(o.hostname, env);
};

/**
 * Whether a request names this server: by an address, as localhost, or by a name in LINECLEAR_HOSTS (comma
 * separated). Any other name may be a web page that pointed its own name at this machine to read and drive it.
 */
export function knownHost(hostname: string, env: Env): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (h === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.startsWith("[")) return true;
  return (env.LINECLEAR_HOSTS ?? "").split(",").some((n) => n.trim().toLowerCase() === h);
}
