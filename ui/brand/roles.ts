// One small icon per role, on a 16 unit grid with a 1.5 stroke, in the picture language of docs/brand.md: the
// Dispatcher is the signal box, the reviewer the signal, the rules the points, main the line the tracks join. The
// web pages draw them from here in the text's colour.

export const ROLE_ICONS = {
  you: {
    label: "You",
    shapes: [{ circle: [8, 5, 2.75] }, { d: "M2.75 14.25c.4-2.9 2.5-4.5 5.25-4.5s4.85 1.6 5.25 4.5" }],
  },
  dispatcher: {
    label: "Dispatcher",
    shapes: [{ d: "M2.25 7.5 8 3l5.75 4.5" }, { d: "M3.75 6.5v7.25h8.5V6.5" }, { d: "M5.75 8.25h4.5v2.5h-4.5z" }],
  },
  roadmap: {
    label: "Roadmap",
    shapes: [{ d: "M1.75 12.25h9" }, { circle: [3.5, 12.25, 1.5], fill: true }, { circle: [7.5, 12.25, 1.5], fill: true }, { d: "M12 13.75V2.75l3 1.6-3 1.6" }],
  },
  rules: {
    label: "Rules",
    shapes: [{ d: "M1.75 11.5h12.5" }, { d: "M4.5 11.5c4.5 0 5-6.5 9.75-6.5" }, { d: "M3 4.5 5.75 8" }, { circle: [3, 4.5, 1.25], fill: true }],
  },
  worker: {
    label: "Worker",
    shapes: [{ d: "M10.6 2.1a3.4 3.4 0 0 0-3.5 4.6L2.6 11.2a1.5 1.5 0 0 0 2.1 2.1l4.5-4.5a3.4 3.4 0 0 0 4.6-3.5l-2 2-2-.6-.6-2z" }],
  },
  reviewer: {
    label: "Reviewer",
    shapes: [{ d: "M5.25 4.25a2.75 2.75 0 0 1 5.5 0v1a2.75 2.75 0 0 1-5.5 0z" }, { circle: [8, 4.75, 1.1], fill: true }, { d: "M8 8v6.25M5.5 14.25h5" }],
  },
  main: {
    label: "Main",
    shapes: [{ d: "M1.75 11h10.5" }, { d: "M1.75 4.25c5 0 5.25 6.75 10.5 6.75" }, { circle: [12.75, 11, 1.75], fill: true }],
  },
  planner: {
    label: "Planner",
    shapes: [{ d: "M10.75 2.25 13.75 5.25 6 13H3v-3z" }, { d: "M9 4l3 3" }],
  },
  inbox: {
    label: "Inbox",
    shapes: [{ d: "M2.25 9.25 4.25 3h7.5l2 6.25v3.25a1.25 1.25 0 0 1-1.25 1.25h-9a1.25 1.25 0 0 1-1.25-1.25z" }, { d: "M2.25 9.25h3.25l1 1.5h3l1-1.5h3.25" }],
  },
} as const satisfies Record<string, { label: string; shapes: readonly ({ d: string } | { circle: readonly [number, number, number]; fill?: boolean })[] }>;

export type RoleName = keyof typeof ROLE_ICONS;
