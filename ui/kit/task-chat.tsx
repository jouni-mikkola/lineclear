import { useState } from "react";

// What a task's chat has that the Dispatcher's does not: the reactions and the quote of a reply on a message.

const EMOJIS = ["👍", "✅", "👀", "❓"];

/** What a message carries besides its words: the reactions on it, and the buttons to react or reply. */
export function Reactions({
  item,
}: {
  item: { reactions?: { emoji: string; by: "me" | "them" | "both" }[]; onReact: (emoji: string) => void; onReply?: () => void };
}) {
  const [picking, setPicking] = useState(false);
  const mine = (e: string) => item.reactions?.some((r) => r.emoji === e && r.by !== "them");
  // the controls show for the row you point at or focus, and always where there is no hover; set reactions stay
  const quiet = picking ? "" : "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(hover:none)]:opacity-100";
  const chip = "inline-flex min-h-9 min-w-9 items-center justify-center rounded-full px-2 text-sm focus-visible:outline-2 focus-visible:outline-accent";
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1" data-reactions>
      {item.reactions?.map((r) => (
        <button
          key={r.emoji}
          type="button"
          aria-pressed={mine(r.emoji)}
          aria-label={`${r.emoji} ${r.by === "them" ? "from the agent" : r.by === "me" ? "from you" : "from both"}`}
          onClick={() => item.onReact(r.emoji)}
          className={`${chip} ${mine(r.emoji) ? "bg-raised3 text-fg" : "bg-raised2 text-fg2"}`}
          data-reaction={r.emoji}
        >
          {r.emoji}
        </button>
      ))}
      {picking &&
        EMOJIS.filter((e) => !item.reactions?.some((r) => r.emoji === e)).map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => {
              setPicking(false);
              item.onReact(e);
            }}
            className={`${chip} bg-raised2 text-fg2 hover:bg-raised3`}
            aria-label={`React with ${e}`}
            data-react-with={e}
          >
            {e}
          </button>
        ))}
      <button
        type="button"
        onClick={() => setPicking(!picking)}
        className={`${chip} ${quiet} text-fg3 hover:text-fg`}
        aria-expanded={picking}
        aria-label="React"
        data-react
      >
        {picking ? "×" : "+"}
      </button>
      {item.onReply && (
        <button type="button" onClick={item.onReply} className={`${chip} ${quiet} px-3 text-fg3 hover:text-fg`} data-reply>
          Reply
        </button>
      )}
    </div>
  );
}

/** The message another one answers, as a quiet line above it. */
export function Quote({ text }: { text: string }) {
  return (
    <p className="mb-1 line-clamp-2 break-words border-l-2 border-line2 pl-3 text-sm text-fg3" data-quote>
      {text}
    </p>
  );
}
