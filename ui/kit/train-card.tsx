import { useEffect } from "react";
import { ago, exact } from "./format.ts";
import { ROLE_ICONS } from "../brand/roles.ts";
import { RoleIcon, type RoleName } from "./roles.tsx";
import type { Stage } from "./parts.tsx";
import { kilo, type Placed, STAGE_WORD, stageOf } from "./line-parts.tsx";

/** Who acts on a task at each stage. */
const STAGE_ROLE: Record<Stage, RoleName> = { queued: "rules", work: "worker", review: "reviewer", ready: "main", done: "main" };

/** The card a train shows on hover, focus or tap: its title and result, the role at work, the model and the time at its stage. */
export function TrainCard({ p, w, onClose }: { p: Placed; w: number; onClose: () => void }) {
  const { t } = p;
  const stage = stageOf(t);
  const width = Math.min(300, w);
  const left = Math.max(0, Math.min(p.x - 24, w - width));
  const load = t.load && stage !== "queued" ? t.load : undefined;
  // a card pinned by a tap leaves with Escape or a tap on anything but a train or the card
  useEffect(() => {
    const away = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !(e.target as Element | null)?.closest("[data-task], [data-card]")) onClose();
    };
    addEventListener("keydown", away);
    addEventListener("pointerdown", away);
    return () => {
      removeEventListener("keydown", away);
      removeEventListener("pointerdown", away);
    };
  }, [onClose]);
  return (
    <div
      role="tooltip"
      className="absolute z-20 rounded border border-line bg-base/95 p-3 text-left shadow-[0_8px_24px_color-mix(in_srgb,var(--lc-rail-bg)_70%,transparent)]"
      style={{ left, top: p.y + 26, width }}
      data-card={t.id}
    >
      <p className="break-words text-sm font-medium text-fg">{t.title}</p>
      {t.result && (
        <p className="mt-1 break-words text-xs text-fg2" data-result>
          {t.result}
        </p>
      )}
      <p className="mt-0.5 truncate text-xs text-fg3">{p.project}</p>
      <p className="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-fg2">
        <RoleIcon role={STAGE_ROLE[stage]} size={14} hidden />
        <span className="min-w-0 truncate" title={t.since !== undefined ? exact(t.since) : undefined}>
          <span className="text-fg">{ROLE_ICONS[STAGE_ROLE[stage]].label}</span>
          {" · "}
          {t.state === "need" ? "waits for you" : t.stalled ? "no sign of life" : STAGE_WORD[stage]}
          {t.since !== undefined ? ` for ${ago(t.since)}` : ""}
        </span>
      </p>
      {t.model && stage !== "queued" && stage !== "done" && <p className="mt-1 truncate font-mono text-xs text-fg3">{t.model}</p>}
      {load && (
        <p className="mt-0.5 text-xs text-fg3" data-load-words>
          Context {kilo(load.used)} of {kilo(load.limit)}
        </p>
      )}
      {p.href && (
        <a
          href={p.href}
          className={`mt-2 inline-flex min-h-11 items-center text-xs underline underline-offset-4 md:min-h-0 ${t.state === "need" ? "text-caution decoration-caution/40" : "text-fg2 decoration-current/40"}`}
        >
          {t.state === "need" ? "Open it in the Inbox" : "Open it"}
        </a>
      )}
    </div>
  );
}
