/** Where the web pages listen: LINECLEAR_HOST and the web port, 127.0.0.1:7420 when unset. */
export function webAddress(env: Record<string, string | undefined> = process.env) {
  // LINECLEAR_WEB_PORT first: the board's command reads LINECLEAR_PORT too, so a web port set there misroutes it
  const name = env.LINECLEAR_WEB_PORT !== undefined ? "LINECLEAR_WEB_PORT" : "LINECLEAR_PORT";
  const port = Number(env[name] ?? 7420);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`${name} is not a port: ${env[name]}`);
  return { hostname: env.LINECLEAR_HOST ?? "127.0.0.1", port };
}
