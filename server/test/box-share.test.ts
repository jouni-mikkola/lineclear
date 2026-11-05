import { expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isGitRead } from '../server/live/box.ts'

const box = { label: 'b', target: 'b', session: 's', herdr: 'herdr', home: '/h', path: '/bin', os: 'Linux' }

/** runs `body` in a worker whose box is a fake ssh (running `ssh`, a shell snippet); returns what it printed and how many ssh calls it made */
function inWorker(body: string, ssh = 'echo ok'): { out: string; calls: number } {
  const dir = mkdtempSync(join(tmpdir(), 'lc-box-share-'))
  const log = join(dir, 'calls')
  mkdirSync(join(dir, 'bin'))
  writeFileSync(join(dir, 'bin', 'ssh'), `#!/bin/sh\necho x >> ${log}\n${ssh.replaceAll('$DIR', dir)}\n`)
  chmodSync(join(dir, 'bin', 'ssh'), 0o755)
  const script = `import { git } from ${JSON.stringify(join(import.meta.dir, '../server/live/engine/git.ts'))}\n${body}`
  const r = Bun.spawnSync(['bun', '-e', script], {
    env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, LINECLEAR_BOX: JSON.stringify(box), LINECLEAR_MAIN_HOME: dir },
    stderr: 'pipe',
  })
  expect(r.stderr.toString()).toBe('')
  const calls = readFileSync(log, 'utf8').trim().split('\n').length
  return { out: r.stdout.toString().trim(), calls }
}

test('the same git read asked many times at once is one ssh call', () => {
  expect(inWorker(`await Promise.all(Array.from({ length: 20 }, () => git('/r', 'rev-parse', 'HEAD')))`).calls).toBe(1)
})

test('a git write between two reads makes the second read ask again', () => {
  expect(inWorker(`await git('/r', 'rev-parse', 'HEAD'); await git('/r', 'commit', '-m', 'x'); await git('/r', 'rev-parse', 'HEAD')`).calls).toBe(3)
})

test('a read that began while a write ran is not shared once the write is done', () => {
  // the fake ssh counts the commits that landed; a commit lands only once the first read has asked, however busy the machine
  const ssh = `case "$*" in *commit*) for i in $(seq 600); do [ -e $DIR/asked ] && break; sleep 0.1; done; echo c >> $DIR/commits;; *) touch $DIR/asked; wc -l < $DIR/commits 2>/dev/null || echo 0;; esac`
  const body = `const w = git('/r', 'commit', '-m', 'x'); const during = (await git('/r', 'rev-parse', 'HEAD')).out; await w; console.log(during, (await git('/r', 'rev-parse', 'HEAD')).out)`
  expect(inWorker(body, ssh).out.replace(/\s+/g, ' ')).toBe('0 1')
})

test('other commands, and git reads, do not cancel a shared read', () => {
  const body = `const r = git('/r', 'rev-parse', 'HEAD'); await git('/r', 'branch', '--show-current'); await Bun.$\`true\`; await r; await git('/r', 'rev-parse', 'HEAD')`
  expect(inWorker(body).calls).toBe(2)
})

test('only git reads are shared', () => {
  expect(isGitRead(['git', 'rev-parse', 'HEAD'])).toBe(true)
  expect(isGitRead(['git', 'worktree', 'list'])).toBe(true)
  expect(isGitRead(['git', 'worktree', 'remove', 'x'])).toBe(false)
  expect(isGitRead(['git', 'commit'])).toBe(false)
  expect(isGitRead(['git', 'branch', '--show-current'])).toBe(true)
  expect(isGitRead(['git', 'branch', '-D', 'x'])).toBe(false)
  expect(isGitRead(['git', 'config', 'user.name', 'x'])).toBe(false)
})

test('many herdr calls to a box ride one ssh', () => {
  // the fake ssh answers every request line with its id
  const ssh = `while read l; do id=\${l#*\\"id\\":\\"}; id=\${id%%\\"*}; echo "{\\"id\\":\\"$id\\",\\"result\\":{}}"; done`
  const herdr = JSON.stringify(join(import.meta.dir, '../server/live/herdr.ts'))
  const body = `const { rpc } = await import(${herdr}); await Promise.all(Array.from({ length: 30 }, () => rpc('ping'))); await rpc('ping'); console.log('done'); process.exit(0)`
  const r = inWorker(body, ssh)
  expect(r.out).toBe('done')
  expect(r.calls).toBe(1)
})
