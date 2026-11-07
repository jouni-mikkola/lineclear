// Records which repo files each test really loads, for scripts/load-map.ts. Inert unless the check sets LINECLEAR_LOAD_MAP.
// Preloaded by bunfig.toml for the test process and, through BUN_OPTIONS, for every bun process a test spawns (the CLI
// included); a child learns which test file it works for from LINECLEAR_LOAD_OWNER, which the test process keeps current.
import { plugin } from "bun";
import { afterAll, beforeEach } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const dir = process.env.LINECLEAR_LOAD_MAP;
const root = process.env.LINECLEAR_LOAD_ROOT;
if (dir && root) {
  const pairs = new Set<string>();
  plugin({
    name: "load-map",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        pairs.add(`${args.importer}\0${args.path}`);
        return undefined;
      });
    },
  });
  const inRepo = (path: string) => path.startsWith(`${root}/`) && !path.includes("/node_modules/");
  const resolve = (path: string, importer: string): string | undefined => {
    try {
      const found = Bun.resolveSync(path, importer.startsWith("/") ? dirname(importer) : root);
      return inRepo(found) ? relative(root, found) : undefined;
    } catch {
      return undefined;
    }
  };
  const owner = process.env.LINECLEAR_LOAD_OWNER;
  const dump = () => {
    const edges: [string, string][] = [];
    for (const pair of pairs) {
      const [importer = "", path = ""] = pair.split("\0");
      const to = resolve(path, importer);
      if (to) edges.push([inRepo(importer) ? relative(root, importer) : "", to]);
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${process.pid}.json`), JSON.stringify({ owner: owner && relative(root, owner), edges }));
  };
  process.env.BUN_OPTIONS = `${process.env.BUN_OPTIONS ?? ""} --preload=${import.meta.path}`.trim();
  if (owner === undefined) {
    // bun test ends without an exit event
    beforeEach(() => {
      process.env.LINECLEAR_LOAD_OWNER = Bun.main;
    });
    afterAll(dump);
  } else process.on("exit", dump);
}
