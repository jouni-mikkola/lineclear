/** Whether a coordinator may wake on a timer: Lineclear's rules start the next steps, so only the fork's own tests allow it. */
export const timerAllowed = (env: Record<string, string | undefined> = process.env): boolean => env.LINECLEAR_COORDINATOR_TIMER === 'on'
