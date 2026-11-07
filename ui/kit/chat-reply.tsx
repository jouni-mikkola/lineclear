/** The message another one answers, as a quiet line above it. */
export function Quote({ text }: { text: string }) {
  return (
    <p className="mb-1 line-clamp-2 break-words border-l-2 border-line2 pl-3 text-sm text-fg3" data-quote>
      {text}
    </p>
  );
}

/** The button under a message that makes the next one answer it: it shows for the row you point at or focus, and always where there is no hover. */
export function ReplyButton({ onReply }: { onReply: () => void }) {
  return (
    <button
      type="button"
      onClick={onReply}
      className="mt-1 inline-flex min-h-9 items-center rounded-full px-3 text-sm text-fg3 opacity-0 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(hover:none)]:opacity-100"
      data-reply
    >
      Reply
    </button>
  );
}
