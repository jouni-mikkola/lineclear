import { HELP, parseArgs, type Parsed } from './args.ts'
import { type Ctx } from './source-helpers.ts'
import { LiveSourceSubcommands } from './source-subcommands.ts'

export class LiveSourceCli extends LiveSourceSubcommands {
  /* ---------- the lineclear command ---------- */

  async cli(args: string[], ctx: Ctx & { local?: boolean }): Promise<{ out: string; code: number; secrets?: Record<string, string> }> {
    try {
      // the values themselves, for the lineclear command to put in a command's environment or a file: never printed,
      // only with a worker-issued capability whose stored scope selects the secret chain
      if (args[0] === 'secret' && (args[1] === 'run' || args[1] === 'env')) {
        const owner = this.agents.secretAccess.authenticate(ctx.proof)
        if (!owner || this.agents.record(owner.chat)?.finished)
          throw new Error(
            'Secret access needs a current agent credential. Use the owning session command; older sessions must wait for route provisioning. No unauthenticated fallback.',
          )
        if (JSON.stringify(this.agents.secretScope(owner.chat)) !== JSON.stringify(owner.chain)) throw new Error('Secret credential scope is no longer valid.')
        return { out: '', code: 0, secrets: this.secretValues(parseArgs(args).words.slice(2), owner.chain) }
      }
      const out = await this.command(parseArgs(args), ctx)
      return { out: out.endsWith('\n') ? out : `${out}\n`, code: 0 }
    } catch (e) {
      return { out: `${(e as Error).message}\n`, code: 1 }
    }
  }

  /** the board command's words, one row each; a row gives the words it answers to and what it runs */
  protected async command(p: Parsed, ctx: Ctx): Promise<string> {
    const [word, a1, ...rest] = p.words
    if (!word || word === 'help' || p.flags.has('help')) return HELP
    const rows: Record<string, () => string | Promise<string>> = {
      alive: () => this.aliveCommand(a1, ctx),
      status: () => (a1 ? this.reportCommand(a1, rest, p, ctx) : this.statusCommand()),
      room: () => this.roomCommand(a1),
      space: () => this.spaceCommand(a1, rest, p, ctx),
      task: () => this.taskRoute(a1, rest, p, ctx),
      restart: () => this.restartCommand(a1, p, ctx),
      ready: () => this.readyCommand(word, a1, rest, p, ctx),
      todo: () => this.todoCommand(a1, ctx),
      merge: () => this.mergeCommand(a1, ctx),
      pr: () => this.prCommand('pr', a1, ctx),
      checks: () => this.prCommand('checks', a1, ctx),
      plan: () => this.planCommand(a1, p),
      ask: () => this.askCommand(a1, p, ctx),
      alert: () => this.alertCommand(a1, p, ctx),
      show: () => this.showCommand(p, ctx),
      set: () => this.setCommand('set', a1, rest, p, ctx),
      unset: () => this.setCommand('unset', a1, rest, p, ctx),
      doctor: () => this.doctorCommand(),
      secret: () => this.secretCommand(a1, rest, p, ctx),
    }
    // project, from before spaces, is space; done is ready's old name
    rows.project = rows.space
    rows.done = rows.ready
    const row = Object.hasOwn(rows, word) ? rows[word] : undefined
    if (!row) throw new Error(`No command ${word}; lineclear help lists them`)
    return row()
  }
}
