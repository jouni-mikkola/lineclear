import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { sh, repo, world, until, started, placeId, writeJson, fakeHerdr } from './engine-world.ts'

describe("a task's place in herdr", () => {
  const linked = (w: ReturnType<typeof world>, label: string) => w.herdr.spaces.find((x) => x.label === label && x.worktree?.is_linked_worktree)
  const branches = (dir: string) => sh('git branch --list "work/*" --format="%(refname:short)"', dir)

  test("its worktree is made through herdr, nested under the project's space, with .worktreeinclude's files copied in", async () => {
    const w = world()
    const dir = repo()
    writeFileSync(join(dir, '.gitignore'), '.env\nbuild/\n')
    writeFileSync(join(dir, '.worktreeinclude'), '# secrets\n.env\n')
    sh('git add -A && git commit -qm ignore', dir)
    writeFileSync(join(dir, '.env'), 'KEY=1\n')
    sh('mkdir build && touch build/big', dir)
    const { t, key } = await started(w, dir, 'nested')
    const ws = linked(w, `${t.id} Say hello`)!
    expect(ws.worktree).toEqual({ checkout_path: t.worktree!, is_linked_worktree: true, repo_root: dir })
    // herdr opened the repo's own space to nest it under, since none was open
    expect(w.herdr.spaces.some((x) => x.worktree?.checkout_path === dir && !x.worktree.is_linked_worktree)).toBe(true)
    // the agent runs in a tab of its own there (it has the agent's environment); the shell herdr opened is closed
    const s = w.started.find((x) => x.key === key)!
    expect(ws.panes).toEqual([s.pane!])
    expect(w.herdr.cwd.get(s.pane!)).toBe(t.worktree!)
    expect(sh('git branch --show-current', t.worktree!)).toBe('work/1-say-hello')
    expect(readFileSync(join(t.worktree!, '.env'), 'utf8')).toBe('KEY=1\n')
    expect(existsSync(join(t.worktree!, 'build'))).toBe(false)
  })

  test('after the merge herdr removes its worktree and space, its branch goes, and the repo space herdr opened closes', async () => {
    const w = world()
    const dir = repo()
    const { t, key } = await started(w, dir, 'tidy')
    writeFileSync(join(t.worktree!, 'hello.txt'), 'hello\n')
    w.agentIs(key, 'idle')
    expect((await w.engine.merge(t.id)).ok).toBe(true)
    await until(() => !!t.cleaned)
    expect(existsSync(t.worktree!)).toBe(false)
    expect(branches(dir)).toBe('')
    expect(w.herdr.spaces).toEqual([])
    expect(t.kept).toBeUndefined()
    expect(w.engine.keptLeftovers()).toEqual([])
  })

  test('a repo space you were already using stays open', async () => {
    const herdr = fakeHerdr()
    const w = world(herdr)
    const dir = repo()
    const p = await w.places.add(dir, 'yours')
    // yours, open before any task, with an agent of yours in it
    herdr.spaces.push({
      workspace_id: 'mine',
      label: 'yours',
      tab_count: 1,
      worktree: { checkout_path: dir, is_linked_worktree: false, repo_root: dir },
      panes: ['mine:p1'],
    })
    herdr.agentPanes.add('mine:p1')
    const t = w.engine.add({ project: p.name, title: 'Say hello', by: 'test' })
    await until(() => w.started.some((s) => s.key === `${t.id}/Agent`))
    writeFileSync(join(t.worktree!, 'hello.txt'), 'hello\n')
    w.agentIs(`${t.id}/Agent`, 'idle')
    expect((await w.engine.merge(t.id)).ok).toBe(true)
    await until(() => !!t.cleaned)
    expect(herdr.spaces.map((x) => x.workspace_id)).toEqual(['mine'])
  })

  test('unsaved or unmerged work is kept and said so; its space and agent close all the same', async () => {
    const w = world()
    const dir = repo()
    const { t, key } = await started(w, dir, 'keeps')
    writeFileSync(join(t.worktree!, 'hello.txt'), 'hello\n')
    expect((await w.engine.merge(t.id, { self: true })).ok).toBe(true)
    // its agent goes on after the merge: a file it never commits, and a commit main never gets
    writeFileSync(join(t.worktree!, 'late.txt'), 'late\n')
    w.agentIs(key, 'idle')
    await until(() => !!t.cleaned)
    expect(existsSync(join(t.worktree!, 'late.txt'))).toBe(true)
    expect(t.kept).toEqual([`${t.worktree!.replace(homedir(), '~')} (uncommitted changes)`])
    expect(w.news.some((n) => n.startsWith(`${t.id} was merged; kept `) && n.endsWith('(uncommitted changes)'))).toBe(true)
    expect(w.engine.keptLeftovers()[0]).toStartWith(`${t.id} `)
    expect(linked(w, `${t.id} Say hello`)).toBeUndefined()
    expect(w.records[key].finished).toBe(true)
    sh('git add -A && git commit -qm late', t.worktree!)
    await w.engine.sweep()
    expect(t.kept![0]).toEndWith(`(work on ${t.branch} that main lacks)`)
    expect(branches(dir)).toBe(t.branch!)
  })

  test('something still running in its space puts it off; it is tried again later', async () => {
    const w = world()
    const dir = repo()
    const { t, key } = await started(w, dir, 'running')
    const ws = linked(w, `${t.id} Say hello`)!
    // a dev server you started in a pane of its own there
    const { root_pane } = await w.herdr.h.createTab(ws.workspace_id, 'Server', t.worktree!)
    w.herdr.busy.add(root_pane.pane_id)
    writeFileSync(join(t.worktree!, 'hello.txt'), 'hello\n')
    w.agentIs(key, 'idle')
    expect((await w.engine.merge(t.id)).ok).toBe(true)
    expect(existsSync(t.worktree!)).toBe(true)
    expect(t.cleaned).toBeFalsy()
    w.herdr.busy.delete(root_pane.pane_id)
    // a clean-up already running (it saw the pane busy) makes a sweep skip the task: sweep until one lands
    for (let i = 0; i < 100 && !t.cleaned; i++) {
      await w.engine.sweep()
      if (!t.cleaned) await Bun.sleep(50)
    }
    expect(t.cleaned).toBe(true)
    expect(existsSync(t.worktree!)).toBe(false)
  })

  test('stopped with no work: agent, space, worktree and branch go; writing to it makes them again', async () => {
    const w = world()
    const dir = repo()
    const { t, key } = await started(w, dir, 'stopnone')
    const wt = t.worktree!
    expect(await w.engine.stopTask(t.id)).toEqual([])
    expect(existsSync(wt)).toBe(false)
    expect(branches(dir)).toBe('')
    expect(w.herdr.spaces.some((x) => x.label === `${t.id} Say hello`)).toBe(false)
    expect(w.records[key].finished).toBe(true)
    // resumed: the worktree is made again through herdr, nested as before, in the same folder (its agent's session
    // is kept by folder)
    await (w.engine as unknown as { launch(t: unknown): Promise<unknown> }).launch(t)
    expect(t.worktree).toBe(wt)
    expect(existsSync(t.worktree!)).toBe(true)
    expect(linked(w, `${t.id} Say hello`)).toBeTruthy()
  })

  test('stopped with work: its worktree and branch stay; resuming opens its space again through herdr', async () => {
    const w = world()
    const dir = repo()
    const { t, key } = await started(w, dir, 'stopwork')
    writeFileSync(join(t.worktree!, 'wip.txt'), 'wip\n')
    const kept = await w.engine.stopTask(t.id)
    expect(kept).toHaveLength(1)
    expect(kept[0]).toEndWith('(uncommitted changes)')
    expect(existsSync(join(t.worktree!, 'wip.txt'))).toBe(true)
    expect(w.herdr.spaces.some((x) => x.label === `${t.id} Say hello`)).toBe(false)
    w.status[key] = 'gone'
    await (w.engine as unknown as { launch(t: unknown): Promise<unknown> }).launch(t)
    const ws = linked(w, `${t.id} Say hello`)!
    expect(ws.worktree?.checkout_path).toBe(t.worktree!)
    expect(ws.panes).toEqual([w.started.at(-1)!.pane!])
  })

  test('deleted with no work: agent, space, worktree, branch, chat and record all go, and nothing is posted', async () => {
    const w = world()
    const dir = repo()
    const { t, key } = await started(w, dir, 'delnone')
    const wt = t.worktree!
    const news = w.news.length
    expect(await w.engine.deleteTask(t.id)).toEqual([])
    expect(existsSync(wt)).toBe(false)
    expect(branches(dir)).toBe('')
    expect(w.herdr.spaces).toEqual([])
    expect(w.engine.task(t.id)).toBeUndefined()
    expect(w.forgot).toEqual([`chat ${key}`, key])
    expect(w.news.length).toBe(news)
    // its number is never given out again
    expect(w.engine.add({ project: t.project, title: 'Next', by: 'test' }).id).not.toBe(t.id)
  })

  test('deleting refuses work main lacks, and changes nothing; --force deletes it all the same', async () => {
    const w = world()
    const dir = repo()
    const { t, key } = await started(w, dir, 'delwork')
    writeFileSync(join(t.worktree!, 'wip.txt'), 'wip\n')
    await expect(w.engine.deleteTask(t.id)).rejects.toThrow(/holds .*\(uncommitted changes\).*--force/)
    // what it holds comes with the refusal too, for the screen to ask
    expect(await w.engine.deleteTask(t.id).catch((e) => e.held)).toEqual([expect.stringContaining('(uncommitted changes)')])
    expect(w.engine.task(t.id)).toBe(t)
    expect(existsSync(join(t.worktree!, 'wip.txt'))).toBe(true)
    expect(w.status[key]).toBe('working')
    sh('git add -A && git commit -qm wip', t.worktree!)
    await expect(w.engine.deleteTask(t.id)).rejects.toThrow(`work on ${t.branch} that main lacks`)
    expect(await w.engine.deleteTask(t.id, { force: true })).toEqual([])
    expect(existsSync(t.worktree!)).toBe(false)
    expect(branches(dir)).toBe('')
    expect(w.herdr.spaces).toEqual([])
    expect(w.engine.task(t.id)).toBeUndefined()
  })

  test('a merged task can be deleted: its commits stay on main', async () => {
    const w = world()
    const dir = repo()
    const { t, key } = await started(w, dir, 'delmerged-engine')
    writeFileSync(join(t.worktree!, 'hello.txt'), 'hello\n')
    w.agentIs(key, 'idle')
    expect((await w.engine.merge(t.id)).ok).toBe(true)
    await until(() => !!t.cleaned)
    expect(await w.engine.deleteTask(t.id)).toEqual([])
    expect(w.engine.task(t.id)).toBeUndefined()
    expect(sh('git log --format=%s -n 1', dir)).toBe(`${t.id}: Say hello`)
    expect(existsSync(join(dir, 'hello.txt'))).toBe(true)
  })

  test("the sweep puts away merged tasks' leftovers only: never a running task's, nor yours, nor while herdr is away", async () => {
    const dir = repo()
    const p = await world().places.add(dir, 'sweep')
    const old = mkdtempSync(join(tmpdir(), 'shep-old-'))
    // left by an older Shepherdr: squash-merged, marked cleaned, and main moved on over the same lines since
    const make = (n: number, file: string) => {
      const wt = join(old, `work-${n}`)
      sh(`git worktree add -q -b work/${n}-x ${wt} main`, dir)
      writeFileSync(join(wt, file), `${n}\n`)
      sh(`git add -A && git commit -qm "${n}"`, wt)
      return wt
    }
    const merged = make(1, 'a.txt')
    sh('git merge -q --squash work/1-x && git commit -qm "P-1: x"', dir)
    writeFileSync(join(dir, 'a.txt'), 'changed since\n')
    sh('git commit -qam since', dir)
    const dirty = make(2, 'b.txt')
    sh('git merge -q --squash work/2-x && git commit -qm "P-2: x"', dir)
    writeFileSync(join(dirty, 'notes.txt'), 'mine\n')
    const running = make(3, 'c.txt')
    const yours = make(4, 'd.txt')
    sh('git merge -q --squash work/4-x && git commit -qm "yours"', dir)
    const rec = (n: number, wt: string, more: object) => ({
      id: `${p.key}-${n}`,
      n,
      project: placeId.space(p.name),
      title: 'x',
      desc: '',
      by: 'x',
      created: 1,
      updated: 1,
      branch: `work/${n}-x`,
      worktree: wt,
      base: 'main',
      ...more,
    })
    writeJson('tasks.json', {
      next: { [p.key]: 3 },
      tasks: [rec(1, merged, { merged: true, cleaned: true }), rec(2, dirty, { merged: true, cleaned: true }), rec(3, running, { told: 'work' })],
    })
    const w = world()
    w.herdr.down(true)
    await w.engine.sweep()
    expect(existsSync(merged)).toBe(true)
    w.herdr.down(false)
    await w.engine.sweep()
    expect(existsSync(merged)).toBe(false)
    expect(branches(dir).split('\n')).toEqual(['work/2-x', 'work/3-x', 'work/4-x'])
    expect(existsSync(join(dirty, 'notes.txt'))).toBe(true)
    expect(w.engine.task(`${p.key}-2`)!.kept![0]).toEndWith('(uncommitted changes)')
    expect(existsSync(running) && existsSync(yours)).toBe(true)
  })

  test('a squash merge main never had the tree of, with main moved on over the same lines since: it goes, unless work came after', async () => {
    const dir = repo()
    const p = await world().places.add(dir, 'squashed')
    const old = mkdtempSync(join(tmpdir(), 'shep-squashed-'))
    // each branch is squash-merged as it was, without a rebase on main (so no commit of main has its tree), and main
    // then changes the lines it added (so merging it into main now would conflict)
    const squashed = (n: number, subject: string, also?: string) => {
      const wt = join(old, `work-${n}`)
      sh(`git worktree add -q -b work/${n}-x ${wt} main`, dir)
      writeFileSync(join(wt, `${n}.txt`), `${n}\n`)
      if (also) writeFileSync(join(wt, also), `${n}\n`)
      sh(`git add -A && git commit -qm "${n}"`, wt)
      writeFileSync(join(dir, `main-${n}.txt`), 'meanwhile\n')
      sh('git add -A && git commit -qm meanwhile', dir)
      sh(`git merge -q --squash work/${n}-x && git commit -qm "${subject}"`, dir)
      const squash = sh('git rev-parse HEAD', dir)
      writeFileSync(join(dir, `${n}.txt`), 'changed since\n')
      sh('git commit -qam since', dir)
      return { wt, squash }
    }
    const byName = squashed(1, `${p.key}-1: x`)
    const recorded = squashed(2, 'squashed on GitHub')
    const after = squashed(3, `${p.key}-3: x`)
    writeFileSync(join(after.wt, 'more.txt'), 'more\n')
    sh('git add -A && git commit -qm "after the merge"', after.wt)
    // a commit after the merge that undoes part of it: merging it into its squash changes nothing, but it is work
    const undone = squashed(4, `${p.key}-4: x`, '4b.txt')
    sh('git rm -q 4b.txt && git commit -qm "undo part of it"', undone.wt)
    // its recorded squash is no longer on main (main was rewritten), and no commit has its subject
    const gone = squashed(5, 'not by name')
    sh(`git checkout -q -b elsewhere ${gone.squash}`, dir)
    sh('git checkout -q main && git reset -q --hard HEAD~2', dir)
    const rec = (n: number, wt: string, more: object = {}) => ({
      id: `${p.key}-${n}`,
      n,
      project: placeId.space(p.name),
      title: 'x',
      desc: '',
      by: 'x',
      created: 1,
      updated: 1,
      branch: `work/${n}-x`,
      worktree: wt,
      base: 'main',
      merged: true,
      cleaned: true,
      ...more,
    })
    writeJson('tasks.json', {
      next: { [p.key]: 3 },
      tasks: [
        rec(1, byName.wt),
        rec(2, recorded.wt, { squash: recorded.squash }),
        rec(3, after.wt),
        rec(4, undone.wt),
        rec(5, gone.wt, { squash: gone.squash }),
      ],
    })
    const w = world()
    await w.engine.sweep()
    expect(existsSync(byName.wt) || existsSync(recorded.wt)).toBe(false)
    expect(branches(dir).split('\n')).toEqual(['work/3-x', 'work/4-x', 'work/5-x'])
    expect([existsSync(after.wt), sh('git show work/3-x:more.txt', dir)]).toEqual([false, 'more']) // the branch keeps it
    for (const n of [3, 4, 5]) expect(w.engine.task(`${p.key}-${n}`)!.kept![0]).toBe(`branch work/${n}-x (work on work/${n}-x that main lacks)`)
  })

  test("it nests under the project's own space (its coordinator's), which stays open after", async () => {
    const herdr = fakeHerdr()
    const w = world(herdr)
    const dir = repo()
    const p = await w.places.add(dir, 'ownspace')
    // the project's space as Shepherdr opens it for its coordinator: a plain workspace in the repo
    herdr.spaces.push({ workspace_id: 'proj', label: p.name, tab_count: 1, panes: ['proj:p1'] })
    herdr.cwd.set('proj:p1', dir)
    herdr.agentPanes.add('proj:p1')
    const t = w.engine.add({ project: p.name, title: 'Say hello', by: 'test' })
    await until(() => w.started.some((s) => s.key === `${t.id}/Agent`))
    expect(herdr.spaces.map((x) => x.workspace_id)[0]).toBe('proj')
    expect(herdr.spaces.find((x) => x.workspace_id === 'proj')!.worktree).toEqual({ checkout_path: dir, is_linked_worktree: false, repo_root: dir })
    expect(herdr.spaces.filter((x) => !x.worktree?.is_linked_worktree)).toHaveLength(1)
    writeFileSync(join(t.worktree!, 'hello.txt'), 'hello\n')
    w.agentIs(`${t.id}/Agent`, 'idle')
    expect((await w.engine.merge(t.id)).ok).toBe(true)
    await until(() => !!t.cleaned)
    expect(herdr.spaces.map((x) => x.workspace_id)).toEqual(['proj'])
  })

  test('a start herdr finished but whose answer was lost: its worktree is opened, not made twice', async () => {
    const herdr = fakeHerdr()
    const create = herdr.h.worktreeCreate
    herdr.h.worktreeCreate = (async (...a: Parameters<typeof create>) => {
      await create(...a)
      throw new Error('herdr worktree.create timed out')
    }) as typeof create
    const w = world(herdr)
    const { t } = await started(w, repo(), 'lost')
    expect(t.trouble).toBeUndefined()
    expect(linked(w, `${t.id} Say hello`)!.worktree!.checkout_path).toBe(t.worktree!)
  })

  test("the sweep leaves a merged task's agent alone while it works, and after you talk to it again", async () => {
    const w = world()
    const dir = repo()
    const { t, key } = await started(w, dir, 'sweepbusy')
    writeFileSync(join(t.worktree!, 'hello.txt'), 'hello\n')
    expect((await w.engine.merge(t.id, { self: true })).ok).toBe(true)
    await w.engine.sweep()
    expect(existsSync(t.worktree!)).toBe(true)
    w.agentIs(key, 'idle')
    await until(() => !!t.cleaned)
    // resumed after its clean-up, in no worktree (a merged task's is never made again): left alone between replies
    await (w.engine as unknown as { launch(t: unknown): Promise<unknown> }).launch(t)
    expect(existsSync(t.worktree!)).toBe(false)
    w.status[key] = 'idle'
    const n = w.herdr.spaces.length
    await w.engine.sweep()
    expect(w.status[key]).toBe('idle')
    expect(w.herdr.spaces.length).toBe(n)
  })

  test('a task started before keeps its plain space: it is closed by its name, and git removes its worktree', async () => {
    const herdr = fakeHerdr()
    const dir = repo()
    const p = await world(herdr).places.add(dir, 'plain')
    const wt = join(mkdtempSync(join(tmpdir(), 'shep-plain-')), 'work-1')
    sh(`git worktree add -q -b work/1-x ${wt} main`, dir)
    writeFileSync(join(wt, 'x.txt'), 'x\n')
    sh('git add -A && git commit -qm x', wt)
    sh('git merge -q --squash work/1-x && git commit -qm "P-1: x"', dir)
    herdr.spaces.push({ workspace_id: 'old', label: `${p.key}-1 x`, tab_count: 1, panes: ['old:p1'] })
    herdr.cwd.set('old:p1', wt)
    writeJson('tasks.json', {
      next: { [p.key]: 1 },
      tasks: [
        {
          id: `${p.key}-1`,
          n: 1,
          project: placeId.space(p.name),
          title: 'x',
          desc: '',
          by: 'x',
          created: 1,
          updated: 1,
          branch: 'work/1-x',
          worktree: wt,
          base: 'main',
          merged: true,
        },
      ],
    })
    const w = world(herdr)
    await w.engine.sweep()
    expect(existsSync(wt)).toBe(false)
    expect(herdr.spaces).toEqual([])
    expect(w.engine.task(`${p.key}-1`)!.cleaned).toBe(true)
  })
})

describe('pausing', () => {
  test('a working task is interrupted and To do; its agent stays; writing to it goes on', async () => {
    const w = world()
    const { t, key } = await started(w, repo(), 'paused')
    expect(w.engine.statusOf(t)).toBe('work')
    await w.engine.pause(t.id)
    expect(w.engine.statusOf(t)).toBe('todo')
    // the turn the interrupt ends is no question for you
    w.agentIs(key, 'idle')
    expect(w.engine.statusOf(t)).toBe('todo')
    expect(w.records[key].finished).toBeUndefined()
    expect(existsSync(t.worktree!)).toBe(true)
    await expect(w.engine.pause(t.id)).rejects.toThrow(/isn't working/)
    w.engine.youWrote(key)
    expect(t.todo).toBeUndefined()
  })

  test('paused while work it left in the background runs: woken by it, it shows Working again, not To do', async () => {
    const w = world()
    const { t, key } = await started(w, repo(), 'pausebg')
    w.chat.reply = 'A reviewer is checking it now.'
    w.bg[key] = 'agents'
    w.agentIs(key, 'done')
    expect(w.engine.statusOf(t)).toBe('work')
    await w.engine.pause(t.id)
    expect(w.engine.statusOf(t)).toBe('todo')
    w.bg[key] = undefined
    w.agentIs(key, 'working')
    expect(w.engine.statusOf(t)).toBe('work')
    expect(t.todo).toBeUndefined()
  })

  test('an agent paused mid-turn that still reads as working is not taken as woken', async () => {
    const w = world()
    const { t, key } = await started(w, repo(), 'pauselag')
    await w.engine.pause(t.id)
    // herdr has not seen the interrupt land yet
    w.agentIs(key, 'working')
    expect(w.engine.statusOf(t)).toBe('todo')
    w.agentIs(key, 'done')
    expect(w.engine.statusOf(t)).toBe('todo')
  })
})
