/** Waits until `f` holds and throws "never came: <what>" at the deadline. The limit only stops a hang: a busy machine may take long. */
export const until = async (f: () => boolean | Promise<boolean>, what: string = f.toString(), ms = 60_000) => {
  for (const t0 = Date.now(); !(await f()); await Bun.sleep(20)) if (Date.now() - t0 > ms) throw new Error(`never came: ${what}`)
}
