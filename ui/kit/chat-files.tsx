import { Dialog } from "@base-ui/react/dialog";
import type { ReactNode } from "react";
import { sizeText } from "../../src/chat-limits.ts";

// The files in a chat: the icon, the chip of a file, the small picture and the large one.

export interface ChatFile {
  name: string;
  size?: number;
  image: boolean;
  url?: string;
}

export function FileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0 text-fg3">
      <path d="M4 1.75h5L12.25 5v9.25H4z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M9 1.75V5h3.25" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

/** A file that is not a picture: its name and size. */
export function FileChip({ file, children }: { file: { name: string; size?: number; url?: string }; children?: ReactNode }) {
  const body = (
    <>
      <FileIcon />
      <span className="min-w-0 truncate text-fg" title={file.name}>
        {file.name}
      </span>
      {file.size !== undefined && <span className="shrink-0 tabular-nums text-fg3">{sizeText(file.size)}</span>}
    </>
  );
  const cls = "flex min-h-10 max-w-full items-center gap-2 rounded-sm border border-line bg-raised px-3 py-2 text-sm";
  return file.url ? (
    <a href={file.url} download={file.name} className={`${cls} hover:border-fg3 focus-visible:outline-2 focus-visible:outline-accent`} data-file-chip>
      {body}
      {children}
    </a>
  ) : (
    <span className={cls} data-file-chip>
      {body}
      {children}
    </span>
  );
}

/** A picture in the thread, small: one tap opens it large. */
export function Thumb({ file, onOpen }: { file: ChatFile; onOpen: (src: string, alt: string) => void }) {
  const { url } = file;
  if (!url) return <FileChip file={file} />;
  return (
    <button
      type="button"
      onClick={() => onOpen(url, file.name)}
      className="block cursor-zoom-in overflow-hidden rounded-lg border border-line bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      aria-label={`Open ${file.name} large`}
      data-thumb
    >
      <img src={file.url} alt={file.name} loading="lazy" className="block h-40 w-auto max-w-[min(240px,70vw)] object-cover" />
    </button>
  );
}

/** A picture opened large over the page. */
export function Lightbox({ image, onClose }: { image?: { src: string; alt: string }; onClose: () => void }) {
  return (
    <Dialog.Root open={!!image} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-base/80" />
        <Dialog.Popup className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 p-4 outline-none sm:p-10" data-lightbox>
          <Dialog.Title className="sr-only">{image?.alt || "Image"}</Dialog.Title>
          {image && <img src={image.src} alt={image.alt} className="max-h-[calc(100dvh-120px)] max-w-full rounded-sm object-contain" />}
          <div className="flex max-w-full items-center gap-3 text-sm">
            <span className="min-w-0 truncate text-fg2">{image?.alt}</span>
            <Dialog.Close className="min-h-9 shrink-0 rounded-sm bg-raised3 px-3 text-fg hover:bg-line2 focus-visible:outline-2 focus-visible:outline-accent">
              Close
            </Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
