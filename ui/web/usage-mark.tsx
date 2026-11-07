import type { HomeData } from "./data.ts";

// Home's one usage mark: a thin week bar per account in the chat column's footer, amber only for an account whose
// week runs ahead of its pace. A click opens the sheet with the figures; the sheet is the only place Home shows them.

export function UsageMark({ d, onOpen }: { d?: HomeData; onOpen: () => void }) {
  const accounts = (d?.usage ?? []).filter((u) => !u.unreported);
  const tip = accounts.map((u) => `${u.account}: week ${u.week ? `${Math.round(u.week.percent)}%` : "not reported"}`).join("\n");
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Usage"
      title={tip || undefined}
      className="flex min-h-9 w-full items-center gap-2 rounded-sm px-1 hover:bg-raised2 focus-visible:outline-2 focus-visible:outline-accent"
      data-usage-mark
    >
      {accounts.length === 0 ? (
        <span className="h-1 flex-1 rounded-full bg-line" />
      ) : (
        accounts.map((u) => (
          <span
            key={u.account}
            className="h-1 flex-1 overflow-hidden rounded-full bg-line"
            data-account={u.account}
            data-ahead={u.pace === "ahead" || undefined}
          >
            <span
              className={`block h-full rounded-full ${u.pace === "ahead" ? "bg-caution" : "bg-fg3"}`}
              style={{ width: `${Math.min(100, u.week?.percent ?? 0)}%` }}
            />
          </span>
        ))
      )}
    </button>
  );
}
