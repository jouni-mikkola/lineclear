/** written once it ran: never again on this machine */
export const TOOK_OVER = 'took-over-herdr-projects.json'

export interface TookOver {
  at: number
  backup: string
  /** what was done, for the chat */
  text: string
  /** said in the home space's chat */
  said?: boolean
}
