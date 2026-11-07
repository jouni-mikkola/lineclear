/** One answer of the model that read a step cold. A no-go carries what it found missing. */
export interface ColdReading {
  step?: string;
  model: string;
  go: boolean;
  said: string;
  missing?: string;
}

/** A plan's Inbox ask: the go of each step its fresh reader took to mean something. A no-go never reaches it. */
export function InboxChecks({ checks }: { checks?: { step: string; model: string; said: string }[] }) {
  if (!checks?.length) return null;
  return (
    <div data-inbox-checks>
      <ColdRead readings={checks.map((c) => ({ ...c, go: true }))} />
    </div>
  );
}

/**
 * The step check as lines: the step (where it is not clear from the page), its go or no-go and the checking model,
 * and the model's words one tap away.
 */
export function ColdRead({ readings }: { readings: ColdReading[] }) {
  return (
    <ul className="space-y-1" data-cold-read>
      {readings.map((r) => (
        <li key={`${r.step ?? ""}${r.go}${r.said}`} data-cold-go={r.go ? "go" : "no-go"} data-cold-step={r.step}>
          <details>
            <summary className="flex min-w-0 max-w-full cursor-pointer list-none items-baseline gap-2 text-sm text-fg2 hover:text-fg">
              {r.step && <span className="shrink-0 tabular-nums text-fg3">{r.step}</span>}
              <span className={`shrink-0 ${r.go ? "text-clear" : "text-caution"}`}>{r.go ? "go" : "no-go"}</span>
              <span className="min-w-0 truncate text-fg3" title={r.model}>
                {r.model}
              </span>
            </summary>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg2">{r.said || "It said nothing back."}</p>
            {!r.go && r.missing && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg3">Missing: {r.missing}</p>}
          </details>
        </li>
      ))}
    </ul>
  );
}
