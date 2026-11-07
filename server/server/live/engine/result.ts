/** A task's result is one sentence of at most 140 characters, on what the owner can see or do once it lands. */
export function checkResult(result: string | undefined) {
  const t = result?.trim()
  if (t && (t.length > 140 || /[.!?]\s+[A-Z]/.test(t)))
    throw new Error(`--result is one sentence of at most 140 characters, on what the owner can see or do once it lands (${t.length} now).`)
  return t
}
