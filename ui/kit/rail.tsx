import { createElement, type ReactNode, type SVGProps } from "react";
import { cssVar, type Shape } from "../brand/rail.ts";
import * as part from "../brand/rail.ts";

// The picture language's parts as React, drawn from the same shapes as the README (ui/brand/rail.ts). Each draws
// around (0, 0) inside an <svg> of the caller, or as a small picture of its own with `Pic`.

const camel = (k: string) => (k.startsWith("data-") ? k : k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()));

// a shape's `style` is CSS text (the README writes it as is); React wants an object
const styleOf = (css: string) =>
  Object.fromEntries(
    css
      .split(";")
      .filter(Boolean)
      .map((d) => d.split(":") as [string, string])
      .map(([k, v]) => [camel(k.trim()), v.trim()]),
  );

/** Shapes from ui/brand/rail.ts as React SVG elements. */
export function Shapes({ shapes }: { shapes: Shape[] }): ReactNode {
  return shapes.map((s, i) =>
    createElement(
      s.tag,
      { key: i, ...Object.fromEntries(Object.entries(s.a).map(([k, v]) => [camel(k), k === "style" ? styleOf(String(v)) : v])) },
      s.kids ? <Shapes shapes={s.kids} /> : undefined,
    ),
  );
}

export const paint = cssVar;

/** One part as a small picture of its own: `box` is its viewBox around (0, 0). */
export function Pic({
  shapes,
  box,
  width,
  height,
  label,
  ...rest
}: { shapes: Shape[]; box: [number, number, number, number]; width: number; height: number; label?: string } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={width}
      height={height}
      viewBox={box.join(" ")}
      className="shrink-0 overflow-visible"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      {...rest}
    >
      <Shapes shapes={shapes} />
    </svg>
  );
}

/** A signal on its own, its lamp in the aspect: amber waits, green is clear, red only when broken. */
export function SignalPic({ aspect, size = 24, label }: { aspect: part.SignalAspect; size?: number; label?: string }) {
  return <Pic shapes={part.signal(aspect, paint)} box={[-8, -34, 16, 34]} width={(size * 16) / 34} height={size} label={label} data-signal={aspect} />;
}

/** A train on its own. With `load` a wagon rides behind it (outside its box, to the left) whose cargo is the context it carries. */
export function TrainPic({ look = "work", width = 30, label, load }: { look?: part.TrainLook; width?: number; label?: string; load?: number }) {
  return <Pic shapes={part.train(look, paint, { load })} box={[-16, -8, 32, 16]} width={width} height={width / 2} label={label} data-train-look={look} />;
}

/** The signal box on its own: the Dispatcher's picture. */
export function SignalBoxPic({ size = 28, ink, writing }: { size?: number; ink?: part.Ink; writing?: boolean }) {
  return <Pic shapes={part.signalBox(paint, { w: 24, h: 16, ink, writing })} box={[-15, -16, 30, 26]} width={(size * 30) / 26} height={size} />;
}

/** An engine on its own: an account's picture. `fill` (0 to 1) is how much of its limit is used. */
export function EnginePic({ size = 30, ink, fill }: { size?: number; ink?: part.Ink; fill?: number }) {
  return <Pic shapes={part.engine(paint, { ink, fill })} box={[-16, -14, 32, 27]} width={size} height={(size * 27) / 32} />;
}

/** A station on its own. */
export function StationPic({ look, size = 16, label }: { look: part.StationLook; size?: number; label?: string }) {
  return <Pic shapes={part.station(look, paint, 6)} box={[-8, -8, 16, 16]} width={size} height={size} label={label} data-station-look={look} />;
}

const SIDINGS_PER_COLUMN = 4;

/** A machine's task slots as a yard: one siding per slot, a train in each busy one, the free ones empty. */
export function SidingsPic({ total, busy }: { total: number; busy: number }) {
  const shown = Math.min(total, 24);
  const cols = Math.ceil(shown / SIDINGS_PER_COLUMN);
  const rows = Math.min(shown, SIDINGS_PER_COLUMN);
  const len = 40;
  const colW = len + 14;
  const rowH = 14;
  const shapes: Shape[] = [];
  for (let i = 0; i < shown; i++) {
    const x = Math.floor(i / SIDINGS_PER_COLUMN) * colW;
    const y = (i % SIDINGS_PER_COLUMN) * rowH;
    shapes.push(
      part.at(x, y, [...part.siding(paint, len), ...(i < busy ? [part.at(len / 2 - 1, 0, part.train("work", paint, { w: 24, h: 8 }))] : [])], {
        "data-siding": i < busy ? "busy" : "free",
      }),
    );
  }
  const w = cols * colW;
  const h = (rows - 1) * rowH + 12;
  return <Pic shapes={shapes} box={[-2, -6, w, h]} width={w} height={h} label={`${busy} of ${total} task slots busy`} data-sidings />;
}

/** An empty part: a track that runs to a station with nothing at it yet. Never the mark. */
export function EmptyTrack({ width = 120 }: { width?: number }) {
  const shapes: Shape[] = [...part.rail("M0 0H36", paint), part.at(44, 0, part.station("ahead", paint, 6))];
  return <Pic shapes={shapes} box={[-4, -10, 60, 20]} width={width} height={(width * 20) / 60} data-empty-track />;
}
