import clsx from 'clsx'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { setUI, useStore } from '@client/kernel.ts'
import { escapeHtml, highlighter, HIGHLIGHT_MAX, highlightLines, languageOf, loadHighlighter } from '@client/highlight.ts'
import { BackIcon, FileIcon, FolderIcon, FolderOpenIcon, ic, IconButton, NextIcon, ReloadIcon, SearchIcon, Small } from '@client/ui.tsx'
import type { DiffFile, FileText, Task, TreeFiles } from '@shared/types.ts'

/* ---------- asking the server ---------- */

type Ask = { what: 'files' | 'diff' | 'pr' } | { what: 'file' | 'patch'; path: string }
/** manual: asked by a press of Refresh (it spins then; the asks every few seconds don't) */
type Got<T> = { data?: T; error?: string; loading: boolean; manual?: boolean }

/** what each ask last got, kept while the screen is open: a tab shown again draws at once, then refreshes */
const got = new Map<string, Got<unknown>>()
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((l) => l())

const keyOf = (task: string, a: Ask) => `${task}|${a.what}|${'path' in a ? a.path : ''}`

async function ask(task: string, a: Ask, manual = false) {
  const k = keyOf(task, a)
  got.set(k, { ...(got.get(k) ?? {}), loading: true, manual })
  changed()
  try {
    const q = new URLSearchParams({ task, what: a.what, ...('path' in a ? { path: a.path } : {}) })
    const r = await fetch(`api/worktree?${q}`)
    const b = (await r.json().catch(() => ({}))) as { error?: string }
    got.set(k, r.ok ? { data: b, loading: false } : { error: b.error ?? `It said ${r.status}.`, loading: false })
  } catch {
    got.set(k, { ...(got.get(k) ?? {}), error: "Can't reach Lineclear right now.", loading: false })
  }
  changed()
}

/** an ask's answer, asked when shown and again every `every` ms while it shows */
export function useAsk<T>(task: string, a: Ask | null, every = 0): Got<T> & { reload: () => void; spin: boolean } {
  const k = a ? keyOf(task, a) : ''
  const v = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => (k ? got.get(k) : undefined),
  ) as Got<T> | undefined
  useEffect(() => {
    if (!a) return
    ask(task, a)
    if (!every) return
    const t = setInterval(() => document.visibilityState === 'visible' && ask(task, a), every)
    return () => clearInterval(t)
    // the key says all an ask is
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, every])
  const now = v ?? { loading: !!a }
  // Refresh spins while you asked, or while nothing has come yet; a quiet ask now and then doesn't spin it
  return { ...now, spin: now.loading && (!!now.manual || !now.data), reload: () => a && ask(task, a, true) }
}

/* ---------- a tree of paths ---------- */

export interface Node {
  name: string
  path: string
  kids?: Node[]
}

/** paths as a tree, folders first; `squash` joins a folder with its only folder ("src/webhooks") */
export function treeOf(paths: string[], squash = false): Node[] {
  const root: Node = { name: '', path: '', kids: [] }
  for (const p of paths) {
    let at = root
    const parts = p.split('/')
    parts.forEach((name, i) => {
      const path = parts.slice(0, i + 1).join('/')
      if (i === parts.length - 1) return at.kids!.push({ name, path })
      let next = at.kids!.find((k) => k.kids && k.name === name)
      if (!next) at.kids!.push((next = { name, path, kids: [] }))
      at = next
    })
  }
  const tidy = (n: Node): Node => {
    if (!n.kids) return n
    let kids = n.kids.map(tidy).sort((a, b) => (!!b.kids === !!a.kids ? a.name.localeCompare(b.name) : a.kids ? -1 : 1))
    let out: Node = { ...n, kids }
    while (squash && out.path && out.kids!.length === 1 && out.kids![0].kids) {
      const only = out.kids![0]
      out = { name: `${out.name}/${only.name}`, path: only.path, kids: only.kids }
      kids = out.kids!
    }
    return out
  }
  return tidy(root).kids!
}

/** a tree's rows as they show: an open folder's rows under it */
function rowsOf(nodes: Node[], open: Set<string>, depth = 0): { node: Node; depth: number }[] {
  return nodes.flatMap((n) => [{ node: n, depth }, ...(n.kids && open.has(n.path) ? rowsOf(n.kids, open, depth + 1) : [])])
}

/**
 * A tree of files: a folder opens and shuts, a file is picked. One row is in the Tab order; the arrow keys walk the
 * rows (right opens a folder, left shuts it or goes to its folder), Enter picks.
 */
export function Tree({
  nodes,
  open,
  setOpen,
  picked,
  onPick,
  meta,
  label,
}: {
  nodes: Node[]
  open: Set<string>
  setOpen: (s: Set<string>) => void
  picked?: string
  onPick: (path: string) => void
  meta?: (path: string) => ReactNode
  label: string
}) {
  const rows = rowsOf(nodes, open)
  const [cur, setCur] = useState(picked ?? rows[0]?.node.path)
  const ref = useRef<HTMLDivElement>(null)
  const at = Math.max(
    0,
    rows.findIndex((r) => r.node.path === cur),
  )
  const focus = (i: number) => {
    const r = rows[Math.max(0, Math.min(rows.length - 1, i))]
    if (!r) return
    setCur(r.node.path)
    ref.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(r.node.path)}"]`)?.focus()
  }
  const flip = (n: Node, to?: boolean) => {
    const s = new Set(open)
    if (to ?? !s.has(n.path)) s.add(n.path)
    else s.delete(n.path)
    setOpen(s)
  }
  const key = (e: KeyboardEvent) => {
    const r = rows[at]
    if (!r) return
    const k = e.key
    if (k === 'ArrowDown') focus(at + 1)
    else if (k === 'ArrowUp') focus(at - 1)
    else if (k === 'Home') focus(0)
    else if (k === 'End') focus(rows.length - 1)
    else if (k === 'ArrowRight' && r.node.kids) open.has(r.node.path) ? focus(at + 1) : flip(r.node, true)
    else if (k === 'ArrowLeft') {
      if (r.node.kids && open.has(r.node.path)) flip(r.node, false)
      else for (let i = at - 1; i >= 0; i--) if (rows[i].depth < r.depth) return (e.preventDefault(), focus(i))
    } else return
    e.preventDefault()
  }
  return (
    <div ref={ref} role="tree" aria-label={label} onKeyDown={key} className="py-1">
      {rows.map(({ node: n, depth }, i) => (
        <button
          key={n.path}
          type="button"
          role="treeitem"
          data-path={n.path}
          aria-expanded={n.kids ? open.has(n.path) : undefined}
          aria-selected={!n.kids ? n.path === picked : undefined}
          aria-level={depth + 1}
          tabIndex={i === at ? 0 : -1}
          onFocus={() => setCur(n.path)}
          onClick={() => (setCur(n.path), n.kids ? flip(n) : onPick(n.path))}
          style={{ '--depth': depth } as CSSProperties}
          className="press mx-1.5 flex h-8 w-[calc(100%---spacing(3))] items-center gap-1.5 rounded-row pr-2 pl-[calc(--spacing(1.5)+var(--depth)*--spacing(3.5))] text-left text-[0.8125rem] text-fg hover:bg-hover focus-visible:shadow-[inset_0_0_0_1.5px_var(--focus)] focus-visible:outline-none aria-selected:bg-sel aria-selected:hover:bg-sel coarse:h-11 phone:h-11 phone:text-[0.9375rem]"
        >
          {n.kids ? (
            <NextIcon className={clsx('size-3.5 shrink-0 text-fg3 motion-safe:transition-transform', open.has(n.path) && 'rotate-90')} />
          ) : (
            <span className="size-3.5 shrink-0" />
          )}
          {n.kids ? (
            open.has(n.path) ? (
              <FolderOpenIcon className={clsx(ic, 'text-fg3')} />
            ) : (
              <FolderIcon className={clsx(ic, 'text-fg3')} />
            )
          ) : (
            <FileIcon className={clsx(ic, 'text-fg3')} />
          )}
          <span className="min-w-0 flex-1 truncate">{n.name}</span>
          {meta?.(n.path)}
        </button>
      ))}
    </div>
  )
}

/** the way back to the list, for the bar over what is picked in it: shown only while the two take turns */
const Back = createContext<{ label: string; go: () => void } | null>(null)

/* ---------- the two panes: a list, and what is picked in it ---------- */

/**
 * A list beside what is picked in it when the panel is wide; when it is narrow (a phone), one at a time: the list,
 * then the pick with a way back.
 */
export function Panes({
  list,
  pick,
  picked,
  onBack,
  back = 'All files',
}: {
  list: ReactNode
  pick: ReactNode
  picked: boolean
  onBack: () => void
  back?: string
}) {
  return (
    <div className="@container/pane flex min-h-0 flex-1 flex-col">
      <div className="grid min-h-0 flex-1 grid-rows-1 @[40rem]/pane:grid-cols-[minmax(220px,32%)_minmax(0,1fr)]">
        <div className={clsx('flex min-h-0 flex-col @[40rem]/pane:border-r @[40rem]/pane:border-line', picked && '@max-[40rem]/pane:hidden')}>{list}</div>
        <div className={clsx('flex min-h-0 min-w-0 flex-col', !picked && '@max-[40rem]/pane:hidden')}>
          {picked ? (
            <Back.Provider value={{ label: back, go: onBack }}>{pick}</Back.Provider>
          ) : (
            <div className="grid flex-1 place-items-center px-6">
              <Small className="text-fg3">Pick a file to see it here.</Small>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** A quiet bar over a list or a file: Back to the list when it's narrow, what it is, then its buttons */
export function Bar({ children, onReload, loading }: { children: ReactNode; onReload?: () => void; loading?: boolean }) {
  const back = useContext(Back)
  return (
    <div
      className={clsx(
        'flex min-h-9 shrink-0 items-center gap-2 border-b border-line pr-1.5 text-[0.75rem] text-fg2 phone:min-h-11 phone:text-[0.875rem]',
        back ? 'pl-1.5 @[40rem]/pane:pl-3' : 'pl-3',
      )}
    >
      {back ? (
        <IconButton label={`Back to ${back.label.toLowerCase()}`} onClick={back.go} className="@[40rem]/pane:hidden">
          <BackIcon className={ic} />
        </IconButton>
      ) : null}
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      {onReload ? (
        <IconButton label="Refresh" onClick={onReload} className={clsx(loading && '[&>svg]:motion-safe:animate-spin')}>
          <ReloadIcon className={ic} />
        </IconButton>
      ) : null}
    </div>
  )
}

export function Note({ children, error }: { children: ReactNode; error?: boolean }) {
  return (
    <div className="px-4 py-6 text-center">
      <Small className={clsx('font-sans text-pretty', error ? 'text-need-fg' : 'text-fg3')}>{children}</Small>
    </div>
  )
}

/** a path cut short at its start, so its file name always shows */
export function PathText({ path }: { path: string }) {
  const at = path.lastIndexOf('/')
  return (
    <span title={path} className="flex min-w-0 font-mono">
      {at > 0 ? <span className="min-w-0 truncate text-fg3 [direction:rtl]">{path.slice(0, at)}</span> : null}
      <span className="shrink-0 text-fg">
        {at > 0 ? <span className="text-fg3">/</span> : null}
        {path.slice(at + 1)}
      </span>
    </span>
  )
}

/** what a panel item has picked, by task (kept while the screen is open, so another tab and back keeps it) */
export function usePicked(task: string, item: string): [string | undefined, (p: string | undefined) => void] {
  const k = `${task}|${item}`
  const v = useStore((s) => s.ui.picked[k])
  return [v || undefined, (p) => setUI((ui) => ({ picked: { ...ui.picked, [k]: p ?? '' } }))]
}

/* ---------- code ---------- */

export function useHighlighter() {
  const [h, setH] = useState(highlighter)
  useEffect(() => {
    if (!h) loadHighlighter().then(setH, () => undefined)
  }, [h])
  return h
}

const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

/** A file's text with its line numbers, highlighted once highlight.js is in */
function Code({ text, path }: { text: string; path: string }) {
  const h = useHighlighter()
  const lines = useMemo(() => {
    const lang = h && text.length <= HIGHLIGHT_MAX ? languageOf(path, h) : null
    const t = text.endsWith('\n') ? text.slice(0, -1) : text
    return lang && h ? highlightLines(t, lang, h) : t.split('\n').map(escapeHtml)
  }, [h, text, path])
  return (
    <div className="code-view min-h-0 flex-1 overflow-auto">
      <table className="min-w-full border-collapse">
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="sticky left-0 w-px bg-bg pr-3 pl-4 text-right align-top text-fg3 tabular-nums select-none">{i + 1}</td>
              <td className="pr-4 align-top whitespace-pre" dangerouslySetInnerHTML={{ __html: l || ' ' }} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ---------- Files ---------- */

/** the up and down arrows walk a list of buttons, which is one stop for Tab */
function walk(e: KeyboardEvent<HTMLDivElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  const all = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
  const at = all.indexOf(document.activeElement as HTMLButtonElement)
  const to = all[Math.min(all.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))]
  if (!to) return
  e.preventDefault()
  all.forEach((b) => (b.tabIndex = b === to ? 0 : -1))
  to.focus()
}

function FileView({ task, path }: { task: Task; path: string }) {
  const f = useAsk<FileText>(task.id, { what: 'file', path })
  return (
    <>
      <Bar onReload={f.reload} loading={f.spin}>
        <PathText path={path} />
        {f.data ? <span className="shrink-0 text-fg3 tabular-nums">{bytes(f.data.size)}</span> : null}
      </Bar>
      {f.error ? (
        <Note error>{f.error}</Note>
      ) : !f.data ? (
        <Note>Reading it…</Note>
      ) : f.data.binary ? (
        <Note>A binary file: nothing to read here.</Note>
      ) : (
        <>
          {f.data.tooBig ? <Note>Only its first megabyte shows.</Note> : null}
          <Code text={f.data.text ?? ''} path={path} />
        </>
      )}
    </>
  )
}

export function FilesView({ task }: { task: Task }) {
  const tree = useAsk<TreeFiles>(task.id, { what: 'files' })
  const [picked, pick] = usePicked(task.id, 'files')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(
    () =>
      new Set<string>(
        picked
          ? picked
              .split('/')
              .slice(0, -1)
              .map((_, i, a) => a.slice(0, i + 1).join('/'))
          : [],
      ),
  )
  const files = tree.data?.files ?? []
  const nodes = useMemo(() => treeOf(files), [files])
  const found = q.trim() ? files.filter((f) => f.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 300) : null
  const list = (
    <>
      <Bar onReload={tree.reload} loading={tree.spin}>
        <label className="flex min-w-0 flex-1 items-center gap-1.5">
          <SearchIcon className={clsx(ic, 'text-fg3')} />
          <input
            name="find-file"
            aria-label="Find a file"
            placeholder={tree.data ? `Find in ${files.length}${tree.data.more ? '+' : ''} files` : 'Find a file'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-8 min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg3 phone:text-[1rem]"
          />
        </label>
      </Bar>
      <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain">
        {tree.error ? (
          <Note error>{tree.error}</Note>
        ) : !tree.data ? (
          <Note>Reading its files…</Note>
        ) : found ? (
          found.length ? (
            <div role="list" aria-label="Files found" onKeyDown={walk} className="py-1">
              {found.map((f, i) => (
                <div key={f} role="listitem">
                  <button
                    type="button"
                    tabIndex={i ? -1 : 0}
                    aria-current={f === picked || undefined}
                    onClick={() => pick(f)}
                    className="press mx-1.5 flex h-8 w-[calc(100%---spacing(3))] items-center gap-1.5 rounded-row px-2 text-left text-[0.8125rem] hover:bg-hover focus-visible:shadow-[inset_0_0_0_1.5px_var(--focus)] focus-visible:outline-none aria-current:bg-sel coarse:h-11 phone:h-11 phone:text-[0.9375rem]"
                  >
                    <FileIcon className={clsx(ic, 'text-fg3')} />
                    <PathText path={f} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <Note>No file matches “{q.trim()}”.</Note>
          )
        ) : files.length ? (
          <Tree label="Files" nodes={nodes} open={open} setOpen={setOpen} picked={picked} onPick={pick} />
        ) : (
          <Note>No files yet.</Note>
        )}
      </div>
    </>
  )
  return <Panes list={list} picked={!!picked} onBack={() => pick(undefined)} pick={picked ? <FileView key={picked} task={task} path={picked} /> : null} />
}

/* ---------- Diff ---------- */

export const MARK: Record<DiffFile['status'], [string, string, string]> = {
  added: ['A', 'Added', 'text-ready-fg'],
  modified: ['M', 'Changed', 'text-work-fg'],
  deleted: ['D', 'Deleted', 'text-need-fg'],
  renamed: ['R', 'Renamed', 'text-fg2'],
}
