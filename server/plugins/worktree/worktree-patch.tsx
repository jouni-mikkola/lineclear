import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { escapeHtml, HIGHLIGHT_MAX, highlightLine, languageOf } from '@client/highlight.ts'
import { CheckCircleIcon, ClockIcon, ic, MinusCircleIcon, OpenIcon, Small, XCircleIcon } from '@client/ui.tsx'
import type { Diff, DiffFile, Patch, PrCheck, PullRequest, Task } from '@shared/types.ts'
import { useAsk, useHighlighter, MARK, Bar, PathText, Note, usePicked, treeOf, type Node, Tree, Panes } from './worktree-files.tsx'

function Counts({ add, del, className }: { add: number; del: number; className?: string }) {
  return (
    <span className={clsx('flex shrink-0 gap-1.5 font-mono text-[0.75rem] tabular-nums phone:text-[0.8125rem]', className)}>
      {add ? <span className="text-ready-fg">+{add}</span> : null}
      {del ? <span className="text-need-fg">−{del}</span> : null}
    </span>
  )
}

type Line = { kind: 'hunk' | 'add' | 'del' | 'ctx' | 'note'; text: string; old?: number; new?: number }

/** a unified diff as rows: hunk headers, lines added, taken out and kept, with their old and new numbers */
export function patchLines(patch: string): Line[] {
  const out: Line[] = []
  let o = 0
  let n = 0
  let body = false
  for (const l of patch.split('\n')) {
    const h = l.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/)
    if (h) {
      o = Number(h[1])
      n = Number(h[2])
      body = true
      out.push({ kind: 'hunk', text: l })
    } else if (!body) continue
    else if (l.startsWith('+')) out.push({ kind: 'add', text: l.slice(1), new: n++ })
    else if (l.startsWith('-')) out.push({ kind: 'del', text: l.slice(1), old: o++ })
    else if (l.startsWith(' ')) out.push({ kind: 'ctx', text: l.slice(1), old: o++, new: n++ })
    else if (l.startsWith('\\')) out.push({ kind: 'note', text: l.slice(2) })
    else if (l.startsWith('diff --git')) body = false
  }
  return out
}

function PatchView({ task, file }: { task: Task; file: DiffFile }) {
  const p = useAsk<Patch>(task.id, { what: 'patch', path: file.path })
  const h = useHighlighter()
  const lines = useMemo(() => (p.data?.text ? patchLines(p.data.text) : []), [p.data?.text])
  const lang = h ? languageOf(file.path, h) : null
  const html = useMemo(
    () =>
      lines.map((l) =>
        l.kind === 'hunk' || l.kind === 'note' || !lang || !h || (p.data?.text.length ?? 0) > HIGHLIGHT_MAX
          ? escapeHtml(l.text)
          : highlightLine(l.text, lang, h),
      ),
    [lines, lang, h, p.data?.text],
  )
  const [, word] = MARK[file.status]
  return (
    <>
      <Bar onReload={p.reload} loading={p.spin}>
        <PathText path={file.path} />
        <span className="shrink-0 text-fg3">{file.from ? `from ${file.from}` : word}</span>
        <Counts add={file.add} del={file.del} />
      </Bar>
      {p.error ? (
        <Note error>{p.error}</Note>
      ) : !p.data ? (
        <Note>Reading its changes…</Note>
      ) : p.data.binary ? (
        <Note>A binary file: its changes can't be shown as text.</Note>
      ) : !lines.length ? (
        <Note>{file.status === 'renamed' ? 'Renamed, with no changes inside.' : 'Nothing to show.'}</Note>
      ) : (
        <div className="code-view min-h-0 flex-1 overflow-auto">
          {p.data.tooBig ? <Note>Only its first megabyte shows.</Note> : null}
          <table className="min-w-full border-collapse" aria-label={`Changes in ${file.path}`}>
            <tbody>
              {lines.map((l, i) =>
                l.kind === 'hunk' ? (
                  <tr key={i} className="bg-hover text-fg3">
                    <td colSpan={4} className="py-0.5 pr-4 pl-4 whitespace-pre" dangerouslySetInnerHTML={{ __html: html[i] }} />
                  </tr>
                ) : (
                  <tr key={i} data-line={l.kind} className="data-[line=add]:bg-add data-[line=del]:bg-del">
                    <td className="w-px pl-3 text-right align-top text-fg3 tabular-nums select-none">{l.old ?? ''}</td>
                    <td className="w-px pr-2 pl-2 text-right align-top text-fg3 tabular-nums select-none">{l.new ?? ''}</td>
                    <td
                      aria-hidden
                      className={clsx('w-px pr-1.5 align-top select-none', l.kind === 'add' ? 'text-ready-fg' : l.kind === 'del' ? 'text-need-fg' : 'text-fg3')}
                    >
                      {l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ''}
                    </td>
                    <td className={clsx('pr-4 align-top whitespace-pre', l.kind === 'note' && 'text-fg3 italic')}>
                      <span className="sr-only">{l.kind === 'add' ? 'Added: ' : l.kind === 'del' ? 'Taken out: ' : ''}</span>
                      <span dangerouslySetInnerHTML={{ __html: html[i] || ' ' }} />
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

export function DiffView({ task }: { task: Task }) {
  const d = useAsk<Diff>(task.id, { what: 'diff' }, 15_000)
  const [picked, pick] = usePicked(task.id, 'diff')
  const files = d.data?.files ?? []
  const nodes = useMemo(
    () =>
      treeOf(
        files.map((f) => f.path),
        true,
      ),
    [files],
  )
  const byPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files])
  // every folder of a diff shows open: it is the changed files you came to see
  const [shut, setShut] = useState(new Set<string>())
  const folders = useMemo(() => {
    const all = new Set<string>()
    const walk = (ns: Node[]) => ns.forEach((n) => n.kids && (all.add(n.path), walk(n.kids)))
    walk(nodes)
    return all
  }, [nodes])
  const open = new Set([...folders].filter((p) => !shut.has(p)))
  const n = files.length
  const list = (
    <>
      <Bar onReload={d.reload} loading={d.spin}>
        {d.data ? (
          <>
            <span className="truncate">
              {n ? `${n} ${n === 1 ? 'file' : 'files'} changed` : 'No changes'} against {d.data.base}
            </span>
            <Counts add={d.data.add} del={d.data.del} />
          </>
        ) : (
          <span>Changes</span>
        )}
      </Bar>
      <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain">
        {d.error ? (
          <Note error>{d.error}</Note>
        ) : !d.data ? (
          <Note>Comparing it with main…</Note>
        ) : n ? (
          <Tree
            label="Changed files"
            nodes={nodes}
            open={open}
            setOpen={(s) => setShut(new Set([...folders].filter((p) => !s.has(p))))}
            picked={picked}
            onPick={pick}
            meta={(path) => {
              const f = byPath.get(path)
              if (!f) return null
              const [letter, word, tone] = MARK[f.status]
              return (
                <>
                  <Counts add={f.add} del={f.del} />
                  <span className={clsx('w-3 shrink-0 text-center font-mono text-[0.6875rem] font-semibold phone:text-[0.8125rem]', tone)}>
                    {letter}
                    <span className="sr-only"> ({f.from ? `${word} from ${f.from}` : word})</span>
                  </span>
                </>
              )
            }}
          />
        ) : (
          <Note>
            {task.id} hasn't changed anything against {d.data.base} yet.
          </Note>
        )}
      </div>
    </>
  )
  const f = picked ? byPath.get(picked) : undefined
  return (
    <Panes
      list={list}
      picked={!!f}
      back="Changed files"
      onBack={() => pick(undefined)}
      pick={f ? <PatchView key={`${f.path}|${f.add}|${f.del}`} task={task} file={f} /> : null}
    />
  )
}

/* ---------- Pull request ---------- */

/** the task's PR, as gh tells it (kept a little while on the server) */
function usePr(task: Task) {
  return useAsk<{ pr: PullRequest | null; why?: string }>(task.id, { what: 'pr' }, 60_000)
}

/** greyed out until the task has a PR: what the snapshot says (SHE-59), else what gh said */
export function usePrOff(task: Task) {
  const p = usePr(task)
  if (task.pr || p.data?.pr) return null
  return p.data?.why ?? (p.error ? "Couldn't ask GitHub about its pull request." : 'No pull request yet.')
}

/** a state is a soft tint with its word in the colour (red is for what needs you, so Closed is grey) */
const PR_STATE: Record<PullRequest['state'], [string, string]> = {
  open: ['Open', 'bg-ready/14 text-ready-fg'],
  draft: ['Draft', 'bg-sel text-fg2'],
  merged: ['Merged', 'bg-merged/14 text-merged'],
  closed: ['Closed', 'bg-sel text-fg2'],
}

const CHECK_ICON: Record<PrCheck['state'], [typeof CheckCircleIcon, string, string]> = {
  pass: [CheckCircleIcon, 'text-ready', 'Passed'],
  fail: [XCircleIcon, 'text-need', 'Failed'],
  pending: [ClockIcon, 'text-work', 'Running'],
  skip: [MinusCircleIcon, 'text-fg3', 'Skipped'],
}

/** "2 passed · 1 running" */
function checksLine(cs: PrCheck[]) {
  const n = (s: PrCheck['state']) => cs.filter((c) => c.state === s).length
  return [
    [n('fail'), 'failed'],
    [n('pending'), 'running'],
    [n('pass'), 'passed'],
    [n('skip'), 'skipped'],
  ]
    .filter(([k]) => k)
    .map(([k, w]) => `${k} ${w}`)
    .join(' · ')
}

export function PrView({ task }: { task: Task }) {
  const p = usePr(task)
  const pr = p.data?.pr
  if (!pr) return <Note error={!!p.error}>{p.error ?? (p.data ? (p.data.why ?? 'No pull request yet.') : 'Asking GitHub…')}</Note>
  const [state, tone] = PR_STATE[pr.state]
  return (
    <>
      {/* the bar the other items have: what it is, and Refresh in the same spot */}
      <Bar onReload={p.reload} loading={p.spin}>
        <span className={clsx('rounded-full px-2 text-[0.75rem]/5 font-medium phone:text-[0.8125rem]/6', tone)}>{state}</span>
        <span className="tabular-nums">#{pr.number}</span>
      </Bar>
      <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain">
        <div className="flex flex-col gap-4 p-4 phone:p-5">
          <div className="flex flex-col gap-2">
            <h3 className="text-[0.9375rem]/6 font-semibold text-pretty phone:text-[1.0625rem]/7">{pr.title}</h3>
            <div>
              <a
                href={pr.url}
                target="_blank"
                rel="noreferrer"
                // the secondary button's look (Ghost), as a link
                className="press-dim relative inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[0.8125rem] whitespace-nowrap text-fg2 shadow-[inset_0_0_0_1px_var(--line2)] after:absolute after:-inset-x-0.5 after:-inset-y-2 hover:bg-hover coarse:h-9 phone:h-9 phone:text-[0.875rem]"
              >
                <OpenIcon className={ic} />
                Open on GitHub
              </a>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-[0.75rem] font-medium text-fg3 phone:text-[0.875rem]">
              <span>Checks</span>
              {pr.checks.length ? <span className="font-normal">{checksLine(pr.checks)}</span> : null}
            </div>
            {pr.checks.length ? (
              <ul className="-mx-2">
                {pr.checks.map((c, i) => {
                  const [Icon, color, word] = CHECK_ICON[c.state]
                  const body = (
                    <>
                      <Icon className={clsx(ic, color)} />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="sr-only">{word}: </span>
                        {c.name}
                      </span>
                      {c.url ? <OpenIcon className={clsx(ic, 'text-fg3')} /> : null}
                    </>
                  )
                  return (
                    <li key={`${c.name}${i}`}>
                      {c.url ? (
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noreferrer"
                          className="press flex min-h-8 items-center gap-2 rounded-row px-2 hover:bg-hover coarse:min-h-11 phone:min-h-11"
                        >
                          {body}
                        </a>
                      ) : (
                        <div className="flex min-h-8 items-center gap-2 px-2 coarse:min-h-11 phone:min-h-11">{body}</div>
                      )}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <Small className="text-fg3">No checks on it.</Small>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

/** a done task's worktree is put away: nothing left to browse or compare (worded as the browser's) */
export const mergedOff = (task: Task) => (task.status === 'done' ? `${task.id} is done: its worktree was put away.` : null)
