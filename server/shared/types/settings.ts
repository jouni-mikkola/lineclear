interface SettingRow {
  label: string
  key: string
  value: string
  /** free text instead of a pick list */
  text?: boolean
  /** private instruction text, saved explicitly without a repository file */
  multiline?: boolean
  /** read-only row (machines) */
  fixed?: boolean
  /** a page of Lineclear this row's value is set on (its path); the row is read-only here */
  lineclear?: string
  /** a line under the row's label */
  hint?: string
  /** a refusal or a fault shown under the row */
  warn?: string
  /** pick list values */
  options?: string[]
  /** a number from min to max (step: what it goes up by, 1 when none), with its unit (plural, and one: singular);
   *  off: it may be left empty for off, zero: 0 is off */
  num?: { min: number; max: number; step?: number; unit?: string; one?: string; off?: boolean; zero?: boolean }
  /** the small heading it sits under (Tasks, Coordinators) */
  group?: string
  /** not set at this level: where its value comes from (All machines, a machine's name) */
  from?: string
  /** set at this level: the value a reset goes back to, and where that comes from (Default at All machines) */
  inherits?: { value: string; from: string }
  /** the exact line it adds to every new brief's Settings block, as it is set now (What agents are told) */
  line?: string
}

export interface SettingSection {
  name: string
  rows: SettingRow[]
  /** one line on what the section is for, above its rows */
  about?: string
  /** text shown under the rows as it is (the lines every new brief ends with) */
  note?: string
  /** the note's heading ("Every new brief ends with" when none) */
  noteTitle?: string
  /** the machine whose level it is (a machine's or one of its projects'); none: All machines */
  machine?: string
  /** the level its defaults are set at, as a place id: all (All machines), m:<machine> or p:<machine>:<project> */
  level?: string
  /** one for all machines and projects (alerts, voice): shown once, whatever level is picked */
  global?: boolean
  /** only words in agents' prompts (What agents are told), not how Lineclear runs */
  told?: boolean
  /** the secrets kept at its level, by name (Secrets): added, replaced and removed in masked boxes */
  secrets?: { name: string; at: number }[]
}
