export interface Alert {
  id: string
  from: string
  title: string
  body: string
  /** where tapping it goes; focus: the message or card (by its id, or its question's) brought into view and lit up */
  go: { place: string; task?: string; focus?: string }
  /** one alert per task (its id) or coordinator question: a newer one with the same tag takes the old one's place */
  tag?: string
  /** the card it is about: where a device shows buttons on alerts, they answer it */
  card?: { chat: string; question: string; choices: { label: string; choice: number }[] }
  /** a new message in a coordinator's chat, nothing more: it buzzes only where Notify is All */
  message?: true
  /** about a task (from its agent, or what it needs): it buzzes whatever its place's Notify, which is its coordinator's */
  task?: true
}
