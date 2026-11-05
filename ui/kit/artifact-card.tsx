import { Dialog } from "@base-ui/react/dialog";

// A task's artifact as a card per version: its picture, title, version and who made it. It opens full screen, in a
// frame the server seals, so what an agent made never runs with Lineclear's own rights.

export interface ArtifactCardData {
  id: string;
  title: string;
  n: number;
  when: string;
  by: string;
  note?: string;
  /** The server's check made a picture of it, so its card shows the picture and the mark. */
  checked: boolean;
  /** Where its picture and its sealed page are. */
  thumb: string;
  frame: string;
}

export function ArtifactCard({ a, onOpen }: { a: ArtifactCardData; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-artifact={`${a.id}-v${a.n}`}
      className="block w-full min-w-0 overflow-hidden rounded-lg border border-line bg-raised text-left hover:border-line2 focus-visible:outline-2 focus-visible:outline-accent"
    >
      <span className="grid aspect-[16/10] place-items-center border-b border-line bg-base">
        {a.checked ? (
          <img src={a.thumb} alt="" loading="lazy" className="size-full object-cover object-top" />
        ) : (
          <span className="text-sm text-fg3">No picture yet</span>
        )}
      </span>
      <span className="block space-y-1 p-3">
        <span className="block break-words text-sm font-medium text-fg">{a.title}</span>
        <span className="flex items-center gap-2 text-xs text-fg3">
          <span>v{a.n}</span>
          <span className="min-w-0 truncate">
            {a.by} · {a.when}
          </span>
          {a.checked && <span className="ml-auto shrink-0 text-clear">Checked</span>}
        </span>
        {a.note && <span className="block break-words text-xs text-fg2">{a.note}</span>}
      </span>
    </button>
  );
}

/** One artifact version full screen, in a frame that may run its own scripts and forms and nothing else. */
export function ArtifactFull({ a, onClose }: { a?: ArtifactCardData; onClose: () => void }) {
  return (
    <Dialog.Root open={!!a} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-base/80" />
        <Dialog.Popup className="fixed inset-0 z-50 flex flex-col gap-2 bg-base p-2 outline-none sm:p-4" data-artifact-full>
          <div className="flex items-center gap-3 text-sm">
            <Dialog.Title className="min-w-0 flex-1 truncate font-medium text-fg">{a ? `${a.title} · v${a.n}` : "Artifact"}</Dialog.Title>
            <Dialog.Close className="min-h-9 shrink-0 rounded-sm bg-raised3 px-3 text-fg hover:bg-line2 focus-visible:outline-2 focus-visible:outline-accent">
              Close
            </Dialog.Close>
          </div>
          {a && (
            <iframe
              title={a.title}
              src={a.frame}
              sandbox="allow-scripts allow-forms"
              referrerPolicy="no-referrer"
              className="min-h-0 w-full flex-1 rounded-lg border border-line bg-fg"
            />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
