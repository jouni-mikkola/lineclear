import { webAddress } from "./web-address.ts";

/** The tailnet name of this machine from `tailscale status --json`, or undefined. */
export function tailnetName(statusJson: string): string | undefined {
  try {
    const name = JSON.parse(statusJson)?.Self?.DNSName;
    return typeof name === "string" && name.replace(/\.$/, "") ? name.replace(/\.$/, "") : undefined;
  } catch {
    return undefined;
  }
}

/** The address task links open at from your phone: the web pages published on the tailnet. Undefined without tailscale. */
export function publishedAddress(env: Record<string, string | undefined> = process.env): string | undefined {
  if (!Bun.which("tailscale")) return undefined;
  const p = Bun.spawnSync(["tailscale", "status", "--json"], { stdin: "ignore", timeout: 5000 });
  const name = p.exitCode === 0 ? tailnetName(p.stdout.toString()) : undefined;
  return name ? `https://${name}:${webAddress(env).port}` : undefined;
}

/** The command that publishes a local port on the tailnet at the same port. */
export const serveCommand = (port: number | string) => `tailscale serve --bg --https=${port} http://127.0.0.1:${port}`;
