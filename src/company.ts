import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { companyOfModel, type ModelFile, modelFile } from "./models.ts";
import { dataDir } from "./paths.ts";

const cache = new Map<string, { stamp: number; file: ModelFile }>();

/** The facts of this machine's data folder, read again only when its `models.json` changed. */
export function currentModelFile(): ModelFile {
  const dir = dataDir();
  const path = join(dir, "models.json");
  const stamp = existsSync(path) ? statSync(path).mtimeMs : 0;
  const hit = cache.get(dir);
  if (hit?.stamp === stamp) return hit.file;
  const file = modelFile(dir);
  cache.set(dir, { stamp, file });
  return file;
}

/** The company behind a `provider/model` name, so a reviewer can be picked from another one. */
export const company = (model: string): string => companyOfModel(model, currentModelFile());
