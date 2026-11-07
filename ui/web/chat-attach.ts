import type { Dispatch, SetStateAction } from "react";
import { MAX_FILE_BYTES, MAX_FILES, sizeText } from "../../src/chat-limits.ts";
import type { Attached } from "../kit/index.ts";
import { post } from "./data.ts";

// The files of the next message: each is read and uploaded at once, and shows its own state in the composer.

export const newId = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36);

const base64 = (f: File) =>
  new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => fail(r.error);
    r.readAsDataURL(f);
  });

/** Adding and removing the files of the next message: each is uploaded at once and shows its own state. */
export function useAttach(
  sample: unknown,
  api: string,
  attached: Attached[],
  setAttached: Dispatch<SetStateAction<Attached[]>>,
  pending: { files: Attached[] }[],
) {
  const patch = (id: string, change: Partial<Attached>) => setAttached((as) => as.map((x) => (x.id === id ? { ...x, ...change } : x)));
  const attach = (files: File[]) => {
    let room = MAX_FILES - attached.filter((a) => a.state !== "failed").length;
    for (const f of files) {
      const id = newId();
      const image = /^image\/(png|jpeg|gif|webp)$/.test(f.type);
      const name = f.name || "pasted-image.png";
      const fail = (error: string) => patch(id, { state: "failed", error });
      setAttached((as) => [...as, { id, name, size: f.size, image, url: image ? URL.createObjectURL(f) : undefined, state: "uploading" }]);
      if (room-- <= 0) fail(`A message can carry at most ${MAX_FILES} files.`);
      else if (f.size > MAX_FILE_BYTES) fail(`${name} is too big: a file can be at most ${sizeText(MAX_FILE_BYTES)}.`);
      else if (sample) patch(id, { state: "ready" });
      else {
        void base64(f)
          .then((data) => post<{ id: string }>(`${api}/files`, { name, data }))
          .then((r) => (r.ok ? patch(id, { id: r.data.id, state: "ready" }) : fail(r.error)))
          .catch(() => fail(`${name} could not be read.`));
      }
    }
  };
  const remove = (id: string) =>
    setAttached((as) => {
      const gone = as.find((a) => a.id === id);
      if (gone?.url?.startsWith("blob:") && !pending.some((p) => p.files.includes(gone))) URL.revokeObjectURL(gone.url);
      return as.filter((a) => a.id !== id);
    });
  return { attach, remove };
}
