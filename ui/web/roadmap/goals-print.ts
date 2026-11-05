// Paper is light whatever the theme: the print sheet names its own colours and size, so the token tests skip this file.

// A4 on paper: light, the page alone, small enough for 12 goals on one sheet
export const PRINT = `@media print {
  @page { size: A4; margin: 10mm; }
  body { background: #fff; }
  [data-frame] { min-height: 0; padding: 0; background: #fff; }
  [data-frame] > :not(main), [data-frame] main > :not([data-content]) { display: none; }
  [data-frame] main { padding: 0; }
  [data-goals] { width: 100%; color: #111; font-size: 10px; line-height: 13px; --lc-fg: #111; --lc-fg2: #333; --lc-fg3: #555; --lc-line2: #ddd; --lc-clear: #2f8a5f; --lc-caution: #c58a1f; }
  [data-goals] * { font-size: inherit; line-height: inherit; color: inherit; background-color: transparent; box-shadow: none; print-color-adjust: exact; }
  [data-goals] [data-progress] > span { background-color: var(--lc-clear); }
  [data-goals] [data-progress] { background-color: var(--lc-line2); }
  [data-goals] [data-goal-detail], [data-goals] [data-no-print] { display: none; }
  [data-goals] [data-goal] { break-inside: avoid; }
  [data-goals] [data-goal] > button { padding: 3px 0; gap: 2px; }
  [data-goals] [data-columns] { display: block; column-count: 3; column-gap: 8px; }
  [data-goals] h2 { break-after: avoid; margin-bottom: 4px; }
  [data-goals] section { margin-top: 8px; }
  [data-goals] ul { margin-top: 0; }
}`;
