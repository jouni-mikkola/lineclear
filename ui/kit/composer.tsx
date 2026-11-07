import { type ClipboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { sizeText } from "../../src/chat-limits.ts";
import { FileIcon } from "./chat-files.tsx";

// Where you write: the composer with its tray of attached files, and the keyboard's room on a phone.

export const FOCUS = "focus-visible:outline-2 focus-visible:outline-accent";

/** A file in the composer before it goes; `url` is a picture of it on this page. */
export type Attached = { id: string; name: string; size: number; image: boolean; url?: string; state: "uploading" | "ready" | "failed"; error?: string };

/** A 20 px line icon from one path. */
const Icon = ({ d, size = 20, width = 1.5 }: { d: string; size?: number; width?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
    <path d={d} fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** The composer's attached files: pictures as small thumbnails, other files as chips, each with a remove button. */
function Tray({ files, onRemove }: { files: Attached[]; onRemove: (id: string) => void }) {
  if (!files.length) return null;
  return (
    <div data-tray>
      <ul className="flex gap-2 overflow-x-auto px-3 pt-3" aria-label="Attached files">
        {files.map((f) => {
          const failed = f.state === "failed";
          const remove = (
            <button
              type="button"
              onClick={() => onRemove(f.id)}
              aria-label={`Remove ${f.name}`}
              className={`grid size-6 shrink-0 place-items-center rounded-full bg-base/80 text-fg2 hover:text-fg ${FOCUS}`}
            >
              <Icon d="M4 4l12 12M16 4 4 16" size={10} width={3.2} />
            </button>
          );
          return (
            <li key={f.id} className="shrink-0" data-attached={f.state}>
              {f.image && f.url && !failed ? (
                <div className="relative">
                  <img
                    src={f.url}
                    alt={f.name}
                    className={`size-16 rounded-sm border border-line object-cover ${f.state === "uploading" ? "opacity-50" : ""}`}
                  />
                  <span className="absolute right-1 top-1">{remove}</span>
                </div>
              ) : (
                <div
                  className={`flex h-16 w-56 max-w-[70vw] flex-col justify-center gap-0.5 rounded-sm border bg-raised px-3 ${failed ? "border-caution/60" : "border-line"}`}
                >
                  <div className="flex items-center gap-2">
                    <FileIcon />
                    <span className="min-w-0 flex-1 truncate text-sm text-fg" title={f.name}>
                      {f.name}
                    </span>
                    {remove}
                  </div>
                  <span className={`truncate text-xs ${failed ? "text-caution" : "text-fg3"}`}>
                    {failed ? "Not attached" : f.state === "uploading" ? "Attaching" : sizeText(f.size)}
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {files.map((f) =>
        f.state === "failed" && f.error ? (
          <p key={f.id} className="px-3 pt-2 text-xs text-caution break-words" role="alert">
            {f.error}
          </p>
        ) : null,
      )}
    </div>
  );
}

/**
 * Where you write: words, files by the button, a paste or a drop, and one tap on send. Enter sends with a keyboard;
 * on a touch screen Enter is a new line and the send button sends. `note` is one line under the box (why it cannot send),
 * `disabled` means there is no one to write to, `replying` is the message you answer with the way to drop it.
 */
export function Composer({
  text,
  onText,
  files,
  onFiles,
  onRemove,
  onSend,
  canSend,
  note,
  accept,
  placeholder = "Ask the Dispatcher",
  label = "Message to the Dispatcher",
  disabled,
  replying,
}: {
  text: string;
  onText: (t: string) => void;
  files: Attached[];
  onFiles: (f: File[]) => void;
  onRemove: (id: string) => void;
  onSend: () => void;
  canSend: boolean;
  note?: string;
  accept: string;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  replying?: { text: string; onCancel: () => void };
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  // the box grows with its text, up to eight lines
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 8 * 24 + 20)}px`;
  }, [text]);
  const paste = (e: ClipboardEvent) => {
    const pasted = [...e.clipboardData.files];
    if (!pasted.length) return;
    e.preventDefault();
    onFiles(pasted);
  };
  return (
    <form
      className="rounded-lg border border-line bg-raised focus-within:border-fg3"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSend();
      }}
      data-composer
    >
      {replying && (
        <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-sm text-fg3" data-replying>
          <span className="min-w-0 flex-1 truncate">Replying to: {replying.text}</span>
          <button
            type="button"
            onClick={replying.onCancel}
            className={`grid size-9 shrink-0 place-items-center rounded-sm hover:text-fg ${FOCUS}`}
            aria-label="Drop the reply"
            data-reply-cancel
          >
            ×
          </button>
        </div>
      )}
      <Tray files={files} onRemove={onRemove} />
      <div className="flex items-end gap-1 p-1.5">
        <button
          type="button"
          onClick={() => picker.current?.click()}
          disabled={disabled}
          className={`grid size-11 shrink-0 place-items-center rounded-sm text-fg2 hover:bg-raised3 hover:text-fg ${FOCUS} disabled:opacity-40 disabled:hover:bg-transparent`}
          aria-label="Attach files"
          data-attach
        >
          <Icon d="M15.5 9.25 9.6 15.15a3.6 3.6 0 0 1-5.1-5.1l6.3-6.3a2.4 2.4 0 0 1 3.4 3.4l-6.2 6.2a1.2 1.2 0 0 1-1.7-1.7l5.6-5.6" />
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          accept={accept}
          className="hidden"
          data-picker
          onChange={(e) => {
            const picked = [...(e.target.files ?? [])];
            e.target.value = "";
            if (picked.length) onFiles(picked);
          }}
        />
        <textarea
          ref={box}
          value={text}
          rows={1}
          disabled={disabled}
          onChange={(e) => onText(e.target.value)}
          onPaste={paste}
          onKeyDown={(e) => {
            const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !touch) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
          placeholder={placeholder}
          aria-label={label}
          className="min-h-11 min-w-0 flex-1 resize-none bg-transparent px-2 py-2.5 text-base leading-6 text-fg outline-none placeholder:text-fg3"
          data-message-box
        />
        <button
          type="submit"
          disabled={!canSend}
          className="grid size-11 shrink-0 place-items-center rounded-sm bg-action text-base hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:bg-raised3 disabled:text-fg3 disabled:hover:brightness-100"
          aria-label="Send"
          data-send
        >
          <Icon d="M10 16.1V3.9M4.4 8.9 10 3.9l5.6 5" size={18} width={2} />
        </button>
      </div>
      {note && (
        <p className="px-3 pb-2 text-xs text-fg3" data-composer-note>
          {note}
        </p>
      )}
    </form>
  );
}

/**
 * Keeps a bottom bar above a phone's keyboard: the height the keyboard covers, from the visual viewport, while
 * something you type in has the focus.
 */
export function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const read = () => {
      const typing = document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLInputElement;
      setInset(typing ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0);
    };
    const events: [EventTarget, string][] = [
      [vv, "resize"],
      [vv, "scroll"],
      [window, "focusin"],
      [window, "focusout"],
    ];
    for (const [t, e] of events) t.addEventListener(e, read);
    read();
    return () => {
      for (const [t, e] of events) t.removeEventListener(e, read);
    };
  }, []);
  return inset;
}
