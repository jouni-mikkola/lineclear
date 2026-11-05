// The Settings block Shepherdr ends every new task's brief with: its heading and the words that say who changed a line.

/** the block's first line */
export const SETTINGS_HEAD = 'Settings: (from lineclear show; where the brief above says otherwise, it wins)'

/** who set a line of the block, where it differs from Shepherdr's own default: the coordinator for this one task
 *  (task add --set and its other flags), or the level of Settings it comes from */
export type SetBy = 'task' | 'space' | 'machine' | 'all'
export const SET_BY: Record<SetBy, string> = {
  task: 'set by coordinator for this task',
  space: "this space's setting",
  machine: "this machine's setting",
  all: 'your setting for every machine',
}
