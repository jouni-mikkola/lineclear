// L76: on an installed machine the user sees one name. Reads the CLI's help and doctor, the board's static pages and the
// files and units the install added, and fails on the old product's name. Run it after `install.sh` (the install workflow does).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const OLD = /shepherdr/i;
const home = homedir();
const run = (cmd: string[]) => {
  const p = Bun.spawnSync(cmd, { stdin: "ignore" });
  return `${p.stdout}${p.stderr}`;
};

const help = run(["lineclear", "--help"]);
const commands = [...help.matchAll(/^ {2}([a-z-]+) /gm)].map((m) => m[1] as string);
const seen: [string, string][] = [
  ["lineclear --help", help],
  ["lineclear doctor", run(["lineclear", "doctor"])],
];
for (const c of commands) if (c !== "serve" && c !== "run") seen.push([`lineclear ${c} --help`, run(["lineclear", c, "--help"])]);

const server = join(home, ".local", "share", "lineclear", "server");
for (const f of ["index.html", "public/manifest.webmanifest"]) if (existsSync(join(server, f))) seen.push([f, readFileSync(join(server, f), "utf8")]);
// The built pages are what the browser runs: their scripts draw the words a user reads.
const dist = join(server, "dist");
const built = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? built(join(dir, e.name)) : [join(dir, e.name)])) : [];
for (const f of built(dist)) if (!/\.(png|jpe?g|webp|woff2?|ico|mp4)$/.test(f)) seen.push([`dist/${f.slice(dist.length + 1)}`, readFileSync(f, "utf8")]);
seen.push([
  "pi extension",
  existsSync(join(home, ".pi/agent/extensions/lineclear.ts")) ? readFileSync(join(home, ".pi/agent/extensions/lineclear.ts"), "utf8") : "",
]);
// The pages a user opens, as the board serves them when one answers on LINECLEAR_PORT.
const port = process.env.LINECLEAR_PORT;
if (port)
  for (const page of ["/", "/inbox", "/design"]) {
    const html = await fetch(`http://127.0.0.1:${port}${page}`).then(
      (r) => r.text(),
      () => "",
    );
    if (html) seen.push([`page ${page}`, html]);
  }
const units = run(["sh", "-c", `ls ${home}/.config/systemd/user | grep -i lineclear; cat ${home}/.config/systemd/user/lineclear*.service`]);
seen.push(["service units", units]);
seen.push(["installed names", run(["sh", "-c", `ls ${home}/.local/bin ${home}/.pi/agent/extensions`])]);

// Storage keys, message fields and CSS variables in the built scripts are lowercase and stay until L75 renames them; the name as a word is capitalised.
const isOld = (where: string, text: string) => (where.startsWith("dist/") && where.endsWith(".js") ? /Shepherdr/ : OLD).test(text);
const bad = seen.filter(([where, text]) => isOld(where, text)).map(([where, text]) => `${where}: ${text.match(/.{0,60}shepherdr.{0,40}/i)?.[0]}`);
for (const b of bad) console.error(b);
process.exit(bad.length > 0 ? 1 : 0);
