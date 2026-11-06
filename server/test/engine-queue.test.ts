import { describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Task } from '../shared/types.ts'
import { sh, repo, world, until, started, placeId, writeJson } from './engine-world.ts'

describe('To do: its agent waits for a go', () => {
  const later = "Add hi.txt. Don't start yet, wait for a go."

  test('its agent starts at once on the brief; it shows To do once the agent says so, until it is told to go', async () => {
    const w = world()
    const { t, key } = await started(w, repo(), 'saved', 'Say hi', later)
    expect(w.started.find((s) => s.key === key)?.first).toStartWith(`Say hi\n\n${later}\n\nSettings:`)
    expect(t.worktree).toBeTruthy()
    w.engine.todo(t.id)
    // To do at once, while the agent still ends the turn it said so in, and after
    expect(w.engine.statusOf(t)).toBe('todo')
    w.agentIs(key, 'idle')
    await Bun.sleep(50)
    expect(w.engine.statusOf(t)).toBe('todo')
    const v = w.engine.view(t)
    expect(v.agent?.chat).toBe(key)
    expect(v.agent?.status).toBe('todo')
    // a To do row is its title alone: no second line
    expect(v.sub).toBe('')
    expect(v.state).toMatch(/^To do · added /)
    // no card, no news that it waits on you
    expect(w.posted).toEqual([])
    expect(w.news.some((n) => n.includes('needs you'))).toBe(false)
    // the go is just a message to it: it is at work
    await w.engine.tell(t.id, 'Go ahead.')
    expect(w.sent.at(-1)).toEqual({ key, text: 'Go ahead.' })
    expect(w.engine.statusOf(t)).toBe('work')
  })

  test('talking to it leaves To do; only the agent puts it back, and one that stops otherwise needs you', async () => {
    const w = world()
    const { t, key } = await started(w, repo(), 'talk', 'Say hi', later)
    w.engine.todo(t.id)
    w.agentIs(key, 'idle')
    // stuck on a question while it waits: that needs you
    w.agentIs(key, 'blocked')
    expect(w.engine.statusOf(t)).toBe('need')
    w.agentIs(key, 'idle')
    expect(w.engine.statusOf(t)).toBe('todo')
    // a change to the brief, in its chat
    w.engine.youWrote(key)
    expect(w.engine.statusOf(t)).toBe('work')
    w.agentIs(key, 'working')
    w.engine.todo(t.id)
    expect(w.engine.statusOf(t)).toBe('todo')
    // a go in its chat; its turn ends without it saying it waits again: it needs you, never To do
    await w.engine.tell(t.id, 'go')
    w.agentIs(key, 'idle')
    await until(() => w.engine.statusOf(t) === 'need')
  })

  test('one saved for later with no agent, from before: its agent starts now and waits for a go', async () => {
    const p = await world().places.add(repo(), 'oldlater')
    const id = `${p.key}-1`
    const id2 = `${p.key}-2`
    const old = { project: placeId.space(p.name), by: 'x', created: 1, updated: 1, told: 'todo' }
    const says = "Later. Don't start yet, wait for a go."
    writeJson('tasks.json', {
      next: { [p.key]: 2 },
      tasks: [
        { ...old, id, n: 1, title: 'Saved', desc: 'For later.' },
        { ...old, id: id2, n: 2, title: 'Says so', desc: says, after: id },
      ],
    })
    const w = world()
    await until(() => w.started.some((s) => s.key === `${id2}/Agent`))
    expect(w.started.find((s) => s.key === `${id}/Agent`)?.first).toBe("Saved\n\nFor later.\n\nDon't start yet: wait for a go.")
    // its brief says so in its own words: the line goes in all the same; and what it once waited on is gone
    expect(w.started.find((s) => s.key === `${id2}/Agent`)?.first).toBe(`Says so\n\n${says}\n\nDon't start yet: wait for a go.`)
    expect('after' in w.engine.task(id2)!).toBe(false)
  })
})

describe('Queued after other tasks', () => {
  /** a first task, and a second queued after it (both started) */
  async function chain(name: string, after?: (first: string) => string[]) {
    const w = world()
    const dir = repo()
    const a = await started(w, dir, name, 'First', 'Add a.txt.')
    const b = w.engine.add({ project: a.p.name, title: 'Second', desc: 'Add b.txt.', by: 'test', after: after ? after(a.t.id) : [a.t.id] })
    const bkey = `${b.id}/Agent`
    await until(() => w.started.some((s) => s.key === bkey))
    return { w, dir, a, b, bkey }
  }
  const commit = (wt: string, file: string) => {
    writeFileSync(join(wt, file), `${file}\n`)
    sh(`git add -A && git commit -qm "add ${file}"`, wt)
  }

  test('its agent starts at once with the brief and the wait; it shows Queued, and goes by itself once that task is merged', async () => {
    const { w, a, b, bkey } = await chain('queued')
    expect(b.after).toEqual([a.t.id])
    const first = w.started.find((s) => s.key === bkey)!.first!
    // the brief, with the default way of working Lineclear ends it with, then the wait
    expect(first.startsWith('Second\n\nAdd b.txt.\n\nSettings:')).toBe(true)
    expect(first).toContain('\n\nQueued: this task waits for')
    expect(first).toContain(a.t.id)
    // Queued while its agent reads the brief, and once its turn ends: never Needs you
    expect(w.engine.statusOf(b)).toBe('queued')
    w.agentIs(bkey, 'idle')
    await Bun.sleep(50)
    const v = w.engine.view(b)
    expect([v.status, v.agent?.status, v.sub]).toEqual(['queued', 'queued', `After ${a.t.id}`])
    expect(v.after).toEqual([a.t.id])
    expect(v.state).toMatch(/^Queued · /)
    expect(w.news.some((n) => n.startsWith(`${b.id} needs you`))).toBe(false)
    // the first is merged: the second's agent is told to go (hidden from its chat, a card says why it started)
    commit(a.t.worktree!, 'a.txt')
    await w.engine.done(a.t.id, 'Added a.txt.')
    expect(w.engine.statusOf(b)).toBe('queued')
    expect((await w.engine.merge(a.t.id, { self: true })).ok).toBe(true)
    const go = w.sent.find((s) => s.key === bkey)!
    expect(go.text).toBe(`<lineclear><go>Go: ${a.t.id} is done, start now.\n${a.t.id} (First): Added a.txt.</go></lineclear>`)
    expect(w.posted.some((x) => x.key === bkey && x.id.startsWith('go:'))).toBe(true)
    expect(b.after).toBeUndefined()
    expect(w.engine.statusOf(b)).toBe('work')
    // told once
    w.agentIs(a.key, 'idle')
    expect(w.sent.filter((s) => s.key === bkey).length).toBe(1)
  })

  test('done with nothing to merge (closed) counts as done; done with work to merge does not', async () => {
    const { w, a, b, bkey } = await chain('empty-done')
    commit(a.t.worktree!, 'a.txt')
    await w.engine.done(a.t.id, 'Added a.txt.')
    w.agentIs(a.key, 'idle')
    await until(() => w.engine.statusOf(a.t) === 'ready')
    expect(w.engine.statusOf(b)).toBe('queued')
    const r = await chain('research-done')
    await r.w.engine.done(r.a.t.id, 'Looked into it: nothing to change.')
    r.w.agentIs(r.a.key, 'idle')
    await until(() => r.w.sent.some((s) => s.key === r.bkey))
    expect(r.w.engine.statusOf(r.b)).toBe('work')
    void bkey
  })

  test('it waits for all of them, and its line names only those not done yet', async () => {
    const w = world()
    const dir = repo()
    const a = await started(w, dir, 'waits-all', 'First', 'Look into a.')
    const c = w.engine.add({ project: a.p.name, title: 'Other', desc: 'Look into c.', by: 'test' })
    const b = w.engine.add({ project: a.p.name, title: 'Third', desc: 'Then this.', by: 'test', after: [`${a.t.id.toLowerCase()}, ${c.id}`] })
    await until(() => w.started.some((s) => s.key === `${b.id}/Agent`) && w.started.some((s) => s.key === `${c.id}/Agent`))
    expect(b.after).toEqual([a.t.id, c.id])
    expect(w.engine.subOf(b)).toBe(`After ${a.t.id}, ${c.id}`)
    await w.engine.done(a.t.id, 'Nothing to change.')
    expect(w.engine.subOf(b)).toBe(`After ${c.id}`)
    expect(w.sent.some((s) => s.key === `${b.id}/Agent`)).toBe(false)
    await w.engine.done(c.id, 'Nothing here either.')
    await until(() => w.sent.some((s) => s.key === `${b.id}/Agent`))
    expect(w.sent.find((s) => s.key === `${b.id}/Agent`)!.text).toContain(`Go: ${a.t.id}, ${c.id} are done, start now.`)
  })

  test('a task it waits for is stopped or goes wrong: it needs you, with the reason; going again puts it back', async () => {
    const { w, a, b, bkey } = await chain('halts')
    w.agentIs(bkey, 'idle')
    await w.engine.stopTask(a.t.id)
    expect(w.engine.statusOf(b)).toBe('need')
    expect(w.engine.subOf(b)).toBe(`${a.t.id} was stopped`)
    expect(w.cards.some((c) => c.task === b.id && c.status === 'need' && c.sub === `${a.t.id} was stopped`)).toBe(true)
    expect(w.news).toContain(`${b.id} needs you: ${a.t.id} was stopped`)
    // the stopped task is written to again: the queued one waits again
    w.engine.youWrote(a.key)
    expect(w.engine.statusOf(b)).toBe('queued')
    a.t.trouble = 'could not make a worktree'
    w.agentIs(a.key, 'idle')
    expect(w.engine.subOf(b)).toBe(`${a.t.id} went wrong`)
    expect(w.sent.some((s) => s.key === bkey)).toBe(false)
  })

  test('a task it waits for is deleted: it needs you, saying so', async () => {
    const { w, a, b, bkey } = await chain('deleted')
    w.agentIs(bkey, 'idle')
    await w.engine.deleteTask(a.t.id)
    expect(w.engine.statusOf(b)).toBe('need')
    expect(w.engine.subOf(b)).toBe(`${a.t.id} is gone`)
  })

  test('a message reaches a queued task and leaves it queued: its agent clears the queue itself when it is a go', async () => {
    const { w, a, b, bkey } = await chain('early')
    w.agentIs(bkey, 'idle')
    w.engine.youWrote(bkey)
    expect(b.after).toEqual([a.t.id])
    expect(w.engine.statusOf(b)).toBe('queued')
    // the agent read a go in it
    expect(w.engine.queue(b.id, [], { self: true })).toEqual({ queued: [], went: true })
    w.agentIs(bkey, 'working')
    expect(w.engine.statusOf(b)).toBe('work')
    const told = w.sent.filter((s) => s.key === bkey).length
    await w.engine.done(a.t.id, 'Nothing to change.')
    expect(w.sent.filter((s) => s.key === bkey).length).toBe(told)
  })

  test('task queue: queues a task at work (its agent is told to hold on), changes what it waits for, and clears it', async () => {
    const w = world()
    const dir = repo()
    const a = await started(w, dir, 'requeue', 'First', 'Add a.txt.')
    const c = w.engine.add({ project: a.p.name, title: 'Other', desc: 'Add c.txt.', by: 'test' })
    const b = w.engine.add({ project: a.p.name, title: 'Second', desc: 'Add b.txt.', by: 'test' })
    const bkey = `${b.id}/Agent`
    await until(() => w.started.some((s) => s.key === bkey))
    expect(w.engine.queue(b.id, [a.t.id])).toEqual({ queued: [a.t.id] })
    expect(w.sent.at(-1)!.text).toContain(`Hold on: you are now queued after ${a.t.id}.`)
    expect(w.posted.some((x) => x.key === bkey && x.id.startsWith('queued:'))).toBe(true)
    expect(w.engine.statusOf(b)).toBe('queued')
    expect(w.engine.queue(b.id, [c.id])).toEqual({ queued: [c.id] })
    expect(w.sent.at(-1)!.text).toContain(`You now wait for ${c.id} instead.`)
    // its own agent queues itself: no message for it
    const n = w.sent.length
    w.engine.queue(b.id, [a.t.id, c.id], { self: true })
    expect(w.sent.length).toBe(n)
    expect(w.engine.queue(b.id, [])).toEqual({ queued: [], went: true })
    expect(w.sent.at(-1)!.text).toBe(`<lineclear><go>Go: you no longer wait for ${a.t.id}, ${c.id}, start now.</go></lineclear>`)
    expect(w.engine.statusOf(b)).toBe('work')
    // nothing to clear
    expect(w.engine.queue(b.id, [])).toEqual({ queued: [] })
  })

  test('refused: a task that is not there, itself, a circle; those done already are not waited for', async () => {
    const { w, a, b } = await chain('refused')
    expect(() => w.engine.queue(a.t.id, ['NOPE-9'])).toThrow('No task NOPE-9')
    expect(() => w.engine.queue(a.t.id, [a.t.id])).toThrow("can't wait for itself")
    expect(() => w.engine.queue(a.t.id, [b.id])).toThrow(`That would wait in a circle: ${a.t.id} → ${b.id} → ${a.t.id}`)
    expect(a.t.after).toBeUndefined()
    // an --after refused on add adds no task
    const before = w.engine.tasks.length
    expect(() => w.engine.add({ project: a.p.name, title: 'X', by: 'test', after: ['NOPE-9'] })).toThrow('No task NOPE-9')
    expect(w.engine.tasks.length).toBe(before)
    await w.engine.done(a.t.id, 'Nothing to change.')
    const d = w.engine.add({ project: a.p.name, title: 'After done', by: 'test', after: [a.t.id] })
    expect(d.after).toBeUndefined()
    expect(w.engine.statusOf(d)).toBe('todo')
  })

  test('waiting on you because one was stopped, a message leaves it to its agent to clear the queue', async () => {
    const { w, a, b, bkey } = await chain('halted-go')
    w.agentIs(bkey, 'idle')
    w.engine.youWrote(bkey, { go: false })
    expect(b.after).toEqual([a.t.id])
    await w.engine.stopTask(a.t.id)
    expect(w.engine.statusOf(b)).toBe('need')
    w.engine.youWrote(bkey)
    expect(b.after).toEqual([a.t.id])
    w.engine.queue(b.id, [], { self: true })
    expect(b.after).toBeUndefined()
  })

  test('after a restart: what it waits for is kept and checked again, and a go cut off is sent again', async () => {
    const p = await world().places.add(repo(), 'restart')
    const id = (n: number) => `${p.key}-${n}`
    const base = { project: placeId.space(p.name), by: 'x', created: 1, updated: 1 }
    writeJson('tasks.json', {
      next: { [p.key]: 4 },
      tasks: [
        { ...base, id: id(1), n: 1, title: 'Research', desc: '', reported: true, told: 'ready' },
        { ...base, id: id(2), n: 2, title: 'Then', desc: '', after: [id(1)], told: 'queued', worktree: '/nonexistent', branch: 'b', base: 'main' },
        // its go was sent, but the agent was never seen at work
        {
          ...base,
          id: id(3),
          n: 3,
          title: 'Went',
          desc: '',
          going: 'Go: X-1 is done, start now.',
          told: 'work',
          worktree: '/nonexistent',
          branch: 'b',
          base: 'main',
        },
      ],
    })
    const w = world()
    expect(w.engine.task(id(2))!.after).toEqual([id(1)])
    expect(w.engine.statusOf(w.engine.task(id(2))!)).toBe('queued')
    w.engine.resumeQueue()
    expect(w.engine.statusOf(w.engine.task(id(2))!)).toBe('queued')
    expect(w.sent.find((x) => x.key === `${id(3)}/Agent`)?.text).toBe('<lineclear><go>Go: X-1 is done, start now.</go></lineclear>')
    // seen at work: it is not sent again
    w.agentIs(`${id(3)}/Agent`, 'working')
    expect(w.engine.task(id(3))!.going).toBeUndefined()
  })

  test("another machine's task: named with its machine first, done when that machine says so", async () => {
    const w = world()
    const dir = repo()
    const p = await w.places.add(dir, 'peers')
    expect(() => w.engine.add({ project: p.name, title: 'X', by: 'test', after: ['vm-x:ELA-3'] })).toThrow('only the main machine')
    let theirs: Partial<Task> | 'away' | undefined = { id: 'ELA-3', name: 'Their API', status: 'work' }
    w.engine.peerTask = (machine, id) =>
      machine !== 'vm-x' ? 'unknown' : theirs === 'away' ? 'away' : theirs && id.toUpperCase() === 'ELA-3' ? (theirs as Task) : undefined
    expect(() => w.engine.add({ project: p.name, title: 'X', by: 'test', after: ['vm-y:ELA-3'] })).toThrow('no machine called vm-y')
    expect(() => w.engine.add({ project: p.name, title: 'X', by: 'test', after: ['vm-x:ELA-9'] })).toThrow('vm-x has no task ELA-9')
    const t = w.engine.add({ project: p.name, title: 'Use their API', desc: 'Then use it.', by: 'test', after: ['VM-X:ela-3'] })
    await until(() => w.started.some((s) => s.key === `${t.id}/Agent`))
    expect(t.after).toEqual(['vm-x:ELA-3'])
    expect(w.engine.subOf(t)).toBe('After vm-x:ELA-3')
    // that machine can't be reached: it keeps waiting, and says so
    theirs = 'away'
    w.engine.recheck()
    expect(w.engine.statusOf(t)).toBe('queued')
    expect(w.engine.subOf(t)).toBe("After vm-x:ELA-3 · can't reach vm-x")
    theirs = { id: 'ELA-3', name: 'Their API', status: 'ready', outcome: 'done', said: 'The API is up.' }
    w.engine.recheck()
    expect(w.sent.find((s) => s.key === `${t.id}/Agent`)!.text).toBe(
      '<lineclear><go>Go: vm-x:ELA-3 is done, start now.\nvm-x:ELA-3 (Their API): The API is up.</go></lineclear>',
    )
  })

  test('a task it waited for is merged and then deleted: it stays done, so the queued one waits for the rest only', async () => {
    const w = world()
    const a = await started(w, repo(), 'merged-gone', 'First', 'Add a.txt.')
    const c = w.engine.add({ project: a.p.name, title: 'Other', desc: 'Add c.txt.', by: 'test' })
    const b = w.engine.add({ project: a.p.name, title: 'Third', desc: 'Then this.', by: 'test', after: [a.t.id, c.id] })
    const bkey = `${b.id}/Agent`
    await until(() => w.started.some((s) => s.key === bkey) && w.started.some((s) => s.key === `${c.id}/Agent`))
    commit(a.t.worktree!, 'a.txt')
    await w.engine.done(a.t.id, 'Added a.txt.')
    expect((await w.engine.merge(a.t.id, { self: true })).ok).toBe(true)
    w.agentIs(a.key, 'idle')
    await until(() => !!a.t.cleaned)
    await w.engine.deleteTask(a.t.id)
    // not "a is gone" (which waits for a person): it waits for the other one only
    expect(w.engine.statusOf(b)).toBe('queued')
    expect(w.engine.subOf(b)).toBe(`After ${c.id}`)
    expect(b.after).toEqual([c.id])
    commit(w.engine.task(c.id)!.worktree!, 'c.txt')
    await w.engine.done(c.id, 'Added c.txt.')
    expect((await w.engine.merge(c.id, { self: true })).ok).toBe(true)
    expect(w.sent.some((s) => s.key === bkey && s.text.includes(`Go: ${c.id} is done`))).toBe(true)
  })
})
