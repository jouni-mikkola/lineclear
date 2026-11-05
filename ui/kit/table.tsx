import { type ReactNode, useMemo, useState } from "react";
import { count } from "./format.ts";

// The one table part. Use it for many rows of the same figures to compare or sort. Where a picture says it better (a
// track, a bar, a lamp) draw that instead: docs/design.md says when.

export interface Column<R> {
  key: string;
  label: string;
  /** The unit, written once in the header and never in a cell: "tokens", "$", "min". */
  unit?: string;
  /** A figure: aligned right, in tabular figures, and counted with separators unless `show` writes it. */
  num?: boolean;
  /** How a cell writes its value. */
  show?: (row: R) => ReactNode;
  /** The value rows sort by; without it the cell's own value. */
  sortBy?: (row: R) => string | number;
}

/** A table sorts from this many rows up. */
const SORT_FROM = 11;

const valueFor = <R,>(c: Column<R>, row: R) => (c.sortBy ? c.sortBy(row) : ((row as Record<string, unknown>)[c.key] as string | number));
const cell = <R,>(c: Column<R>, row: R): ReactNode => {
  if (c.show) return c.show(row);
  const v = (row as Record<string, unknown>)[c.key];
  return typeof v === "number" ? count(v) : (v as ReactNode);
};

/**
 * Rows of figures. Figures align right in tabular figures and units sit in the header. From 11 rows the headers sort.
 * The header stays while the rows scroll. A row opens its `details` on a click. Under 640 px each row is a card with
 * the two columns named in `card`, and the same sort and details.
 */
export function DataTable<R extends { id: string }>({
  label,
  columns,
  rows,
  card,
  details,
  height = 420,
  onOpen,
  group,
  cardTitle,
}: {
  label: string;
  columns: Column<R>[];
  rows: R[];
  /** The two columns whose figures show on a phone's card, after the first column that names the row. */
  card: [string, string];
  details?: (row: R) => ReactNode;
  /** A number of pixels, or "fill" to take the room of the parent, whose height is fixed. */
  height?: number | "fill";
  /** Hears the row that opened, or undefined when it closed. */
  onOpen?: (id: string | undefined) => void;
  /** A phone's cards stand under a heading each time this changes from one row to the next. */
  group?: (row: R) => string;
  /** What names a phone's card, in place of the first column's cell. */
  cardTitle?: (row: R) => ReactNode;
}) {
  const sortable = rows.length >= SORT_FROM;
  const [sort, setSort] = useState<{ key: string; down: boolean }>();
  const [open, setOpen] = useState<string>();
  const shown = useMemo(() => {
    const c = columns.find((x) => x.key === sort?.key);
    if (!c || !sort) return rows;
    return [...rows].sort((a, b) => {
      const x = valueFor(c, a);
      const y = valueFor(c, b);
      const d = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return sort.down ? -d : d;
    });
  }, [rows, sort, columns]);
  const by = (key: string) => setSort((s) => (s?.key === key ? { key, down: !s.down } : { key, down: false }));
  const toggle = (id: string) => {
    const next = open === id ? undefined : id;
    setOpen(next);
    onOpen?.(next);
  };
  const fill = height === "fill";
  const cap = fill ? undefined : height;
  const head = (c: Column<R>) => (c.unit ? `${c.label} (${c.unit})` : c.label);
  const first = columns[0]!;
  const cardColumns = card.map((k) => columns.find((c) => c.key === k)!);
  const sortLabel = (c: Column<R>) => {
    const on = sort?.key === c.key;
    return on ? (sort!.down ? " ▼" : " ▲") : "";
  };
  const ariaSort = (c: Column<R>) => (sort?.key === c.key ? (sort.down ? "descending" : "ascending") : sortable ? "none" : undefined);

  return (
    <div data-table={label} data-rows={rows.length} className={fill ? "flex h-full min-h-0 flex-col" : undefined}>
      {sortable && (
        <div className="mb-2 flex flex-wrap items-center gap-1 sm:hidden" role="group" aria-label={`Sort ${label}`}>
          {[first, ...cardColumns].map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => by(c.key)}
              aria-pressed={sort?.key === c.key}
              className="rounded-sm bg-raised2 px-3 text-sm text-fg2 hover:bg-raised3 aria-pressed:text-fg"
            >
              {c.label}
              {sortLabel(c)}
            </button>
          ))}
        </div>
      )}
      <ul
        className={`m-0 list-none overflow-auto rounded-lg border border-line bg-raised p-0 sm:hidden ${fill ? "min-h-0 flex-1" : ""}`}
        style={{ maxHeight: cap }}
        aria-label={label}
        data-table-cards
      >
        {shown.map((r, i) => (
          <li key={r.id} className="border-t border-line first:border-t-0" data-row-id={r.id}>
            {group && (i === 0 || group(shown.at(i - 1) ?? r) !== group(r)) && (
              <p className="bg-raised2 px-4 py-1.5 text-xs font-medium text-fg3" data-group={group(r)}>
                {group(r)}
              </p>
            )}
            <button
              type="button"
              onClick={() => toggle(r.id)}
              aria-expanded={details ? open === r.id : undefined}
              disabled={!details}
              className="flex w-full min-w-0 flex-col gap-1 px-4 py-3 text-left hover:bg-raised2"
            >
              <span className={`${cardTitle ? "line-clamp-2 break-words" : "truncate"} text-sm text-fg`}>{cardTitle ? cardTitle(r) : cell(first, r)}</span>
              <span className="flex gap-6 text-xs text-fg3">
                {cardColumns.map((c) => (
                  <span key={c.key} className="tabular-nums">
                    {c.label}: <span className="text-fg2">{cell(c, r)}</span>
                    {c.unit ? ` ${c.unit}` : ""}
                  </span>
                ))}
              </span>
            </button>
            {details && open === r.id && <div className="border-t border-line bg-raised2 px-4 py-3 text-sm text-fg2">{details(r)}</div>}
          </li>
        ))}
      </ul>
      <div className={`hidden overflow-auto rounded-lg border border-line bg-raised sm:block ${fill ? "min-h-0 flex-1" : ""}`} style={{ maxHeight: cap }}>
        <table className="w-full border-collapse text-sm" aria-label={label}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={ariaSort(c)}
                  className={`sticky top-0 z-10 border-b border-line bg-raised px-4 py-2 text-xs font-medium text-fg3 ${c.num ? "text-right" : "text-left"}`}
                >
                  {sortable ? (
                    <button type="button" onClick={() => by(c.key)} className={`rounded-sm px-1 text-xs hover:text-fg ${sort?.key === c.key ? "text-fg" : ""}`}>
                      {head(c)}
                      {sortLabel(c)}
                    </button>
                  ) : (
                    head(c)
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <TableRow key={r.id} row={r} columns={columns} open={open === r.id} onToggle={details ? () => toggle(r.id) : undefined} details={details} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TableRow<R extends { id: string }>({
  row,
  columns,
  open,
  onToggle,
  details,
}: {
  row: R;
  columns: Column<R>[];
  open: boolean;
  onToggle?: () => void;
  details?: (r: R) => ReactNode;
}) {
  return (
    <>
      <tr
        data-row-id={row.id}
        onClick={onToggle}
        aria-expanded={onToggle ? open : undefined}
        className={`min-h-11 border-t border-line first:border-t-0 ${onToggle ? "cursor-pointer hover:bg-raised2" : ""}`}
      >
        {columns.map((c, i) => (
          <td key={c.key} className={`h-11 px-4 ${c.num ? "text-right tabular-nums text-fg2" : "text-left text-fg"}`}>
            {i === 0 && onToggle ? (
              <button
                type="button"
                onClick={(e) => (e.stopPropagation(), onToggle())}
                aria-expanded={open}
                className="max-w-full truncate rounded-sm text-left hover:underline"
              >
                {cell(c, row)}
              </button>
            ) : (
              cell(c, row)
            )}
          </td>
        ))}
      </tr>
      {details && open && (
        <tr data-details-of={row.id}>
          <td colSpan={columns.length} className="border-t border-line bg-raised2 px-4 py-3 text-fg2">
            {details(row)}
          </td>
        </tr>
      )}
    </>
  );
}
