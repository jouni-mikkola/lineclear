import type { ReactNode } from "react";
import * as part from "../brand/rail.ts";
import { EnginePic, paint, Pic, SignalPic, StationPic, TrainPic } from "./rail.tsx";

/** The key under the map: each picture with its plain word and how many there are now. */
function Key({ items }: { items: { pic: ReactNode; text: string; tone?: string; href?: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-fg2" aria-label="What the pictures mean" data-key-list>
      {items.map((i) => (
        <li key={i.text} className="flex items-center gap-2">
          <span className="flex h-8 w-9 items-center justify-center">{i.pic}</span>
          {i.href ? (
            <a
              data-inline
              href={i.href}
              className={`inline-flex min-h-11 items-center underline decoration-current/40 underline-offset-4 md:min-h-0 ${i.tone ?? ""}`}
            >
              {i.text}
            </a>
          ) : (
            <span className={i.tone ?? ""}>{i.text}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The junction into the main line with its signal, small, for the key. */
function JunctionPic({ aspect }: { aspect: part.SignalAspect }) {
  return (
    <Pic
      shapes={[
        ...part.rail("M-16 4H-2", paint, { w: 2 }),
        part.at(-8, 4, part.signal(aspect, paint, 0.6)),
        part.at(6, 8, part.mainLine(paint, { len: 10, w: 2 })),
      ]}
      box={[-17, -18, 34, 30]}
      width={36}
      height={32}
    />
  );
}

type KeyFacts = {
  working: number;
  queued: number;
  waiting: number;
  review: number;
  ready: number;
  merged: number;
  planning: boolean;
  accounts: number;
  broken: number;
};

/** What the pictures mean, each with this moment's count. */
export function LineKey({ facts }: { facts: KeyFacts }) {
  const { working, queued, waiting, review, ready, merged, planning, accounts, broken } = facts;
  return (
    <Key
      items={[
        { pic: <TrainPic look="work" width={26} />, text: `${working} at work` },
        { pic: <TrainPic look="queued" width={26} />, text: `${queued} in line` },
        {
          pic: <SignalPic aspect="caution" size={26} />,
          text: waiting ? `${waiting} ${waiting === 1 ? "waits" : "wait"} for you` : "nothing waits for you",
          tone: waiting ? "text-caution" : undefined,
          href: waiting ? "/inbox" : undefined,
        },
        { pic: <JunctionPic aspect={review ? "check" : "clear"} />, text: review || !ready ? `${review} in review` : `${ready} ready to merge` },
        ...(review && ready ? [{ pic: <JunctionPic aspect="clear" />, text: `${ready} ready to merge` }] : []),
        { pic: <StationPic look="done" size={14} />, text: `${merged} merged`, tone: merged ? "text-clear" : undefined },
        ...(planning
          ? [
              {
                pic: (
                  <span className="text-fg3" aria-hidden="true">
                    - - -
                  </span>
                ),
                text: "track being laid ahead",
              },
            ]
          : []),
        ...(accounts ? [{ pic: <EnginePic size={24} fill={0.6} />, text: `${accounts} ${accounts === 1 ? "account" : "accounts"}` }] : []),
        ...(broken
          ? [
              {
                pic: <span className="h-1.5 w-7 rounded-full bg-stop" />,
                text: broken === 1 ? "main is broken" : `main is broken in ${broken}`,
                tone: "text-stop",
              },
            ]
          : []),
      ]}
    />
  );
}
