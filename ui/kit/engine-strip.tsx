import { useLayoutEffect, useRef } from "react";
import { EASE } from "../brand/rail.ts";
import { play } from "./motion.ts";
import type { AccountUse } from "./spend-charts.tsx";
import { EnginePic } from "./rail.tsx";

/** The accounts as engines with their fill. The ones that pull a train now are lit; one that takes over pops in. */
export function EngineStrip({ accounts, active, phone }: { accounts: AccountUse[]; active: Set<string>; phone: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const was = useRef<Set<string>>(undefined);
  useLayoutEffect(() => {
    const prev = was.current;
    was.current = active;
    if (!prev || !host.current) return;
    for (const el of host.current.querySelectorAll<HTMLElement>("[data-engine]")) {
      const name = el.dataset.engine ?? "";
      if (active.has(name) && !prev.has(name))
        play(
          "engine-swap",
          el,
          [
            { transform: "translateX(-8px) scale(0.9)", opacity: 0.4 },
            { transform: "none", opacity: 1 },
          ],
          { easing: EASE.out },
        );
      else if (!active.has(name) && prev.has(name)) play("engine-swap", el, [{ opacity: 1 }, { opacity: 0.6 }], { easing: EASE.in });
    }
  });
  return (
    <div ref={host} className="absolute right-0 top-0 flex items-start gap-4" data-engines>
      {accounts.slice(0, phone ? 2 : 4).map((u) => {
        const w = u.session ?? u.week;
        const fill = u.unreported || !w ? undefined : Math.min(1, w.percent / 100);
        const lit = active.has(u.account);
        const label = fill === undefined ? "…" : phone ? `${Math.round(fill * 100)}%` : `${Math.round(fill * 100)}% ${u.account}`;
        return (
          <div key={u.account} data-engine={u.account} data-lit={lit || undefined} className="flex flex-col items-center gap-0.5" title={u.account}>
            <EnginePic size={phone ? 24 : 30} ink={lit ? "fg" : "fg3"} fill={fill} />
            <span title={label} className="max-w-20 truncate text-xs leading-none tabular-nums text-fg3">
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
