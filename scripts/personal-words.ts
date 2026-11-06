// Names that must not appear in a file that ships: the people, machines, network and private projects of the people who
// build Lineclear. They are not in the repository: one word per line in the file LINECLEAR_PERSONAL_WORDS names, else
// ~/.config/lineclear/personal-words.txt. Without a file the scan checks secrets and addresses only.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function personalWords(env = process.env): string[] {
  const file = env.LINECLEAR_PERSONAL_WORDS || join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "lineclear", "personal-words.txt");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w && !w.startsWith("#"));
}
